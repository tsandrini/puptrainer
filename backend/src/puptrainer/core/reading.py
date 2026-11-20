"""Reading a voice against the learner's own everyday voice.

The pipeline measures a take; this module says how far a take lies from the learner's
everyday voice in the two things the training is about, pitch and resonance, and what
that cost (level, clarity). The everyday voice is the mean of the earliest everyday
takes of a comparable kind on the same microphone setup: a fixed starting point, so
progress stays visible when the everyday voice itself moves. Like the evaluation it is
pure and cheap, runs whenever a take is served, and nothing of it is stored.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from puptrainer.core.acoustics import semitones, spacing
from puptrainer.core.schemas import (
    Basis,
    Item,
    MeasureDef,
    Reading,
    ReadingNote,
    Reference,
    Shift,
    VowelSegment,
    Zone,
)

REFERENCE_TAKES = 5
"""The earliest everyday takes of a kind that make the everyday voice."""
MIN_WOBBLE_TAKES = 3
SPEECH_ITEMS = frozenset({Item.PHRASE, Item.PASSAGE, Item.FREE, Item.OTHER})
HELD_ITEMS = frozenset({Item.VOWELS, Item.SUSTAIN})
FORMANT_KEYS = ("f1_median_hz", "f2_median_hz", "f3_median_hz", "f4_median_hz")
# NOTE: F1 follows the jaw and loudness as much as the tract, so it is reported apart
BRIGHT = slice(1, 4)

NOISE_FLOOR_PCT = 2.0
"""A brightness difference under this is never called a change, however steady the takes."""
TYPICAL_PCT = (10.0, 23.0)
"""Where women's F2 to F4 lie above the average man's, speaker by speaker (5th to 95th
percentile, 16% in the middle; boys average 23%, girls 28%): computed from the vowel
tables of Hillenbrand et al. (1995). A convention to read a shift by, not a threshold:
the learner's own everyday voice need not be the average man's."""
R1_TYPICAL_PCT = (8.0, 29.0)
"""The same for F1 (17% in the middle)."""
R1_DROP_PCT = 8.0
QUIETER_DB = 3.0
LESS_CLEAR_DB = 2.0

READING_MEASURES: tuple[MeasureDef, ...] = (
    MeasureDef(key="pitch_shift_st", unit="st", decimals=1),
    MeasureDef(
        key="brightness_pct",
        unit="%",
        decimals=1,
        zones=[
            Zone(key="typical", low=TYPICAL_PCT[0], high=TYPICAL_PCT[1]),
            Zone(key="beyond", low=TYPICAL_PCT[1]),
        ],
    ),
    MeasureDef(
        key="r1_shift_pct",
        unit="%",
        decimals=0,
        zones=[
            Zone(key="typical", low=R1_TYPICAL_PCT[0], high=R1_TYPICAL_PCT[1]),
            Zone(key="beyond", low=R1_TYPICAL_PCT[1]),
        ],
    ),
    MeasureDef(key="level_shift_db", unit="dB", decimals=1),
    MeasureDef(key="clarity_shift_db", unit="dB", decimals=1),
)
"""Every key a reading may report; texts in `content/measures`."""


@dataclass(frozen=True)
class Voice:
    """An analysed take as a reading sees it.

    Attributes:
        id: The take.
        item: What it contains.
        language: Language spoken, if any.
        content_ref: The text read, if any.
        recorded_at: When it was recorded.
        metrics: Its metrics by registry key.
        vowels: The sustained vowels of a `vowels` take.
    """

    id: str
    item: Item
    language: str | None
    content_ref: str | None
    recorded_at: datetime
    metrics: Mapping[str, float]
    vowels: Sequence[VowelSegment] = ()


def comparable(
    item: Item, language: str | None, content_ref: str | None, everyday: Sequence[Voice]
) -> tuple[Basis, list[Voice]] | None:
    """The everyday takes a take of this kind is read against.

    Speech is held against everyday takes of the same text, else of the same kind and
    language, else against everyday speech in general (in its language when there is
    any); held sounds against the everyday sustained vowels. The earliest five count.
    Formants follow the vowels a text contains, so against speech in general only pitch,
    level and clarity are read (see `read`).

    Args:
        item: What the take contains.
        language: The language it is spoken in.
        content_ref: The text it reads.
        everyday: The learner's analysed everyday lab takes on the take's microphone setup.

    Returns:
        How alike the chosen takes are, and the takes, oldest first; `None` when there is
        nothing to read this kind of take against (a glide, or no everyday take yet).
    """
    if item in HELD_ITEMS:
        basis = Basis.VOWELS
        pool = [v for v in everyday if v.item == Item.VOWELS and _vowels(v)]
    elif item in SPEECH_ITEMS:
        spoken = [
            v
            for v in everyday
            if v.item in SPEECH_ITEMS and all(key in v.metrics for key in FORMANT_KEYS)
        ]
        alike = [v for v in spoken if v.item == item and v.language == language]
        same_text = [v for v in alike if content_ref is not None and v.content_ref == content_ref]
        if same_text:
            basis, pool = Basis.SAME_TEXT, same_text
        elif alike and item != Item.PASSAGE:
            basis, pool = Basis.SAME_KIND, alike
        else:
            basis = Basis.SPEECH
            pool = [v for v in spoken if v.language == language] or spoken
    else:
        return None
    if not pool:
        return None
    return basis, sorted(pool, key=lambda v: v.recorded_at)[:REFERENCE_TAKES]


def reference(basis: Basis, takes: Sequence[Voice]) -> Reference:
    """The everyday voice a set of takes adds up to.

    Args:
        basis: How alike the takes are to what is read against them.
        takes: The everyday takes, oldest first (see `comparable`).

    Returns:
        Their pitch and formants as geometric means over the takes; for sustained vowels
        the formants vowel by vowel.
    """
    pitches = [v.metrics["pitch_median_hz"] for v in takes if "pitch_median_hz" in v.metrics]
    vowels: dict[str, list[float]] = {}
    formants: list[float] = []
    if basis == Basis.VOWELS:
        found: dict[str, list[list[float]]] = {}
        for take in takes:
            for vowel, values in _vowels(take).items():
                found.setdefault(vowel, []).append(values)
        vowels = {vowel: _geomean_rows(rows) for vowel, rows in sorted(found.items())}
    else:
        formants = _geomean_rows([[v.metrics[key] for key in FORMANT_KEYS] for v in takes])
    return Reference(
        basis=basis,
        take_ids=[v.id for v in takes],
        pitch_hz=_geomean(pitches) if pitches else None,
        formants_hz=formants,
        vowels=vowels,
    )


def everyday_size_cm(
    item: Item, language: str | None, content_ref: str | None, everyday: Sequence[Voice]
) -> float | None:
    """The apparent tract length of the everyday voice, for a practice take to show beside.

    Args:
        item: What the practice take contains: held sounds are held against the everyday
            "a", speech against everyday speech.
        language: The language it is spoken in.
        content_ref: The text it reads.
        everyday: The learner's analysed everyday lab takes on the same microphone setup.

    Returns:
        The length in cm, or `None` without a comparable everyday take.
    """
    found = comparable(item, language, content_ref, everyday)
    if found is None:
        return None
    voice = reference(*found)
    formants = voice.vowels.get("a", []) if voice.basis == Basis.VOWELS else voice.formants_hz
    return spacing(formants)[1] if formants else None


def read(take: Voice, everyday: Sequence[Voice]) -> Reading | None:
    """Read one take against the learner's everyday voice.

    Args:
        take: The take, analysed.
        everyday: The learner's analysed everyday lab takes on the same microphone setup.

    Returns:
        The take's distance from the everyday voice in pitch, brightness (F2 to F4), the
        first resonance, level and clarity, with the scatter of the everyday takes
        themselves and what the resonance numbers amount to in words. The resonance
        numbers are left out when the everyday takes are of other words (`Basis.SPEECH`):
        an "awww" reads a sixth darker than a sentence for its vowels alone. `None` when
        the take is of a kind that is not read (a glide, a held drill), or nothing of it
        could be compared.
    """
    if take.item == Item.SUSTAIN:
        return None
    found = comparable(take.item, take.language, take.content_ref, everyday)
    if found is None:
        return None
    basis, takes = found
    mine = _numbers(take, basis, takes)
    if not mine:
        return None
    others = [_numbers(member, basis, takes) for member in takes]
    shifts = []
    for key, (value, base) in mine.items():
        scatter = [other[key][0] for other in others if key in other]
        wobble = float(np.std(scatter, ddof=1)) if len(scatter) >= MIN_WOBBLE_TAKES else None
        shifts.append(Shift(key=key, value=value, everyday=base, wobble=wobble))
    return Reading(basis=basis, takes=len(takes), shifts=shifts, notes=_notes(shifts))


def _numbers(
    take: Voice, basis: Basis, takes: Sequence[Voice]
) -> dict[str, tuple[float, float | None]]:
    """A take's shifts from the mean of `takes`, each with the everyday value behind it."""
    ref = reference(basis, takes)
    out: dict[str, tuple[float, float | None]] = {}
    pitch = take.metrics.get("pitch_median_hz")
    if pitch is not None and ref.pitch_hz is not None:
        out["pitch_shift_st"] = (semitones(pitch, ref.pitch_hz), ref.pitch_hz)
    if basis == Basis.VOWELS:
        mine = _vowels(take)
        shared = [vowel for vowel in mine if vowel in ref.vowels]
        if shared:
            ratios = np.array([np.divide(mine[v], ref.vowels[v]) for v in shared])
            out["brightness_pct"] = (_percent(_geomean(ratios[:, BRIGHT].ravel())), None)
            out["r1_shift_pct"] = (_percent(_geomean(ratios[:, 0])), None)
        return out
    if basis != Basis.SPEECH and all(key in take.metrics for key in FORMANT_KEYS):
        ratios = np.divide([take.metrics[key] for key in FORMANT_KEYS], ref.formants_hz)
        out["brightness_pct"] = (_percent(_geomean(ratios[BRIGHT])), None)
        out["r1_shift_pct"] = (_percent(float(ratios[0])), ref.formants_hz[0])
    for key, metric in (("level_shift_db", "speech_level_dbfs"), ("clarity_shift_db", "cpps_db")):
        values = [v.metrics[metric] for v in takes if metric in v.metrics]
        if metric in take.metrics and values:
            base = float(np.mean(values))
            out[key] = (take.metrics[metric] - base, base)
    return out


def _notes(shifts: Sequence[Shift]) -> list[ReadingNote]:
    by_key = {shift.key: shift for shift in shifts}
    notes: list[ReadingNote] = []
    bright = by_key.get("brightness_pct")
    if bright is not None:
        slack = max(NOISE_FLOOR_PCT, 2.0 * (bright.wobble or 0.0))
        if bright.value < -slack:
            notes.append(ReadingNote.DARKER)
        elif bright.value <= slack:
            notes.append(ReadingNote.EVERYDAY)
        elif bright.value < TYPICAL_PCT[0]:
            notes.append(ReadingNote.BRIGHTER)
        elif bright.value <= TYPICAL_PCT[1]:
            notes.append(ReadingNote.TYPICAL)
        else:
            notes.append(ReadingNote.BEYOND)
        first = by_key.get("r1_shift_pct")
        if bright.value > slack and first is not None and first.value <= -R1_DROP_PCT:
            notes.append(ReadingNote.R1_FELL)
    level = by_key.get("level_shift_db")
    if level is not None and level.value <= -QUIETER_DB:
        notes.append(ReadingNote.QUIETER)
    clarity = by_key.get("clarity_shift_db")
    if clarity is not None and clarity.value <= -LESS_CLEAR_DB:
        notes.append(ReadingNote.LESS_CLEAR)
    return notes


def _vowels(take: Voice) -> dict[str, list[float]]:
    """F1 to F4 of each labelled vowel of a vowels take (the first of each)."""
    out: dict[str, list[float]] = {}
    for segment in take.vowels:
        if segment.vowel is not None and len(segment.formants_hz) == 4:
            out.setdefault(segment.vowel, list(segment.formants_hz))
    return out


def _geomean(values: Sequence[float] | np.ndarray) -> float:
    return float(np.exp(np.mean(np.log(values))))


def _geomean_rows(rows: Sequence[Sequence[float]]) -> list[float]:
    return [float(v) for v in np.exp(np.mean(np.log(np.array(rows)), axis=0))]


def _percent(ratio: float) -> float:
    return 100.0 * (ratio - 1.0)
