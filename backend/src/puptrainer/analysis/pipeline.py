"""Pipeline 0.4: what a take measures, as single numbers and frame by frame.

Recording quality, pitch, resonance, voice quality, range, held sounds and whispers.

Every key returned here is in `puptrainer.core.metrics.REGISTRY`. A metric that cannot
be measured (pitch of a silent take) is left out, never reported as a placeholder.
"""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import parselmouth
from parselmouth.praat import call

from puptrainer.core.acoustics import semitones, spacing
from puptrainer.core.schemas import Details, Item, Series, VowelSegment, WhisperSpan

PIPELINE_VERSION = "0.4.2"

TIME_STEP_S = 0.01
FRAME_S = 0.02
PITCH_FLOOR_HZ = 60.0
PITCH_CEILING_HZ = 800.0
GLIDE_CEILING_HZ = 1200.0
# NOTE: Praat's default (0.01) follows subharmonics down an octave in creaky voice
OCTAVE_COST = 0.1
MIN_VOICED_FRAMES = 10
# NOTE: a frame read at about half the pitch around it is a subharmonic (creak, period
# doubling), not a low note: real drops at the ends of phrases are a few semitones
SUBHARMONIC_RATIO = (0.45, 0.56)
CONTEXT_S = 0.75
LOCAL_FLOOR = 0.7
# NOTE: the usual limits of the band in which listeners disagree about a voice;
# conventions pooled from small studies, not thresholds
BAND_LOW_HZ = 145.0
BAND_HIGH_HZ = 185.0
# NOTE: Burg's method wants five formants below its ceiling, so the ceiling has to follow
# the vocal tract: Praat's defaults (5000 Hz, 5500 Hz) are five times the formant spacing
# of an average man and woman. The ceiling is picked from this grid by that rule.
CEILING_STEP_HZ = 250.0
FORMANT_CEILINGS_HZ = tuple(float(c) for c in range(4500, 6501, int(CEILING_STEP_HZ)))
CEILING_PER_SPACING = 5.0
MAX_BANDWIDTH_HZ = 500.0
# NOTE: one held sound is one shape: its upper formants stay within a few percent from
# frame to frame (2-9% between the 10th and 90th percentile on real takes). Where a
# ceiling splits a formant in two, or drops one, the frames flip between two readings
# and scatter by 30% and more; such a run says nothing, whatever its spacing
MAX_HELD_SPREAD_PCT = 15.0
MIN_VOWEL_S = 1.5
# NOTE: a spectrum only shows the vocal tract at the harmonics of the pitch. Above about
# 300 Hz they lie too far apart: the analysis then finds the harmonics themselves (a
# held 671 Hz read "formants" at 671, 1342, 2019, 2690 Hz), so nothing is reported
FORMANT_MAX_F0_HZ = 300.0
GLIDE_STRENGTH = 0.8
# NOTE: a register flip moves a few semitones within a frame or two; a jump of about an
# octave is the tracker's octave error at a creaky bottom, not a break
BREAK_ST = 3.0
OCTAVE_ERROR_ST = (11.3, 12.7)
BREAK_GAP_S = 0.05
BREAK_MERGE_S = 0.25
SPEECH_ITEMS = (Item.PHRASE, Item.PASSAGE, Item.FREE, Item.OTHER)
# NOTE: the stored traces keep every second frame of the pitch track
TRACE_EVERY = 2
LEVEL_WINDOW_S = 0.03
SOURCE_WINDOW_S = 0.05
# NOTE: outside a held sound there is no fit to go by (a whisper, a short voiced bit of a
# drill): Praat's ceiling for a shorter tract, which is also what the live view uses
LOOSE_CEILING_HZ = 5500.0
# NOTE: linear prediction puts its lowest peak on the fundamental, or between it and the
# first resonance, when the fundamental stands far above the harmonics over it (a light
# voice at a raised pitch). An F1 below 1.25 times the pitch is the pitch; one below
# 1.75 times the pitch under a fundamental that leads by 12 dB cannot be told from it.
# On the owner's takes: everyday speech 4-19% of the vowel frames, attempts 33-49%
PITCH_RATIO = 1.25
NEAR_RATIO = 1.75
DOMINANT_DB = 12.0
# NOTE: a whisper comes in puffs: the frames within 15 dB of its loudest, well clear of
# the room, are the sound; a second with fewer than eight of them is not measured
WHISPER_GATE_DB = 15.0
WHISPER_CLEAR_DB = 12.0
# NOTE: the frames where a voice starts and stops are loud and unvoiced: not a whisper
WHISPER_EDGE_FRAMES = 3
# NOTE: around a real voice (a voiced stretch of a quarter of a second or more) the sound
# is neither for longer: the tracker gives up on a soft voice a fifth of a second before
# it has gone, and such frames read the pitch as a resonance (a "whispered" R1 of
# 217-530 Hz beside 830-930 Hz on real takes of a voice let into a whisper). The blips
# a tracker finds inside a whisper keep the short margin, or they would cost seconds
WHISPER_VOICE_FRAMES = 25
WHISPER_VOICE_EDGE_FRAMES = 20
WHISPER_MIN_SHARE = 0.2
WHISPER_SPAN_S = 1.0
WHISPER_MIN_FRAMES = 8


@dataclass
class Analysis:
    """The result of analysing one take.

    Attributes:
        metrics: Values by registry key.
        details: Structured findings (the vowels of a `vowels` take).
        series: Stored series by key (`pitch_hz`).
    """

    metrics: dict[str, float] = field(default_factory=dict)
    details: Details = field(default_factory=Details)
    series: dict[str, Series] = field(default_factory=dict)


def decibels(amplitude: float) -> float:
    """An amplitude relative to full scale, in dB, floored at -120."""
    return 20.0 * float(np.log10(max(amplitude, 1e-6)))


def level_metrics(samples: np.ndarray, sample_rate: float) -> dict[str, float]:
    """Peak, clipping, speech level and noise floor of a mono signal in [-1, 1].

    Args:
        samples: The signal.
        sample_rate: Samples per second.

    Returns:
        `peak_dbfs`, `clipped_samples`, and, for takes of at least ten 20 ms frames,
        `speech_level_dbfs` (90th percentile of frame RMS) and `noise_floor_dbfs` (5th).
    """
    out = {
        "peak_dbfs": decibels(float(np.abs(samples).max())),
        "clipped_samples": float((np.abs(samples) >= 0.999).sum()),
    }
    frame = int(FRAME_S * sample_rate)
    count = len(samples) // frame
    if count >= 10:
        rms = np.sqrt((samples[: count * frame].reshape(count, frame) ** 2).mean(axis=1))
        out["speech_level_dbfs"] = decibels(float(np.percentile(rms, 90)))
        out["noise_floor_dbfs"] = decibels(float(np.percentile(rms, 5)))
    return out


def track(
    sound: parselmouth.Sound,
    floor: float = PITCH_FLOOR_HZ,
    ceiling: float = PITCH_CEILING_HZ,
    octave_cost: float = OCTAVE_COST,
) -> parselmouth.Pitch:
    """Praat's autocorrelation pitch track at the pipeline's time step."""
    return sound.to_pitch_ac(
        time_step=TIME_STEP_S, pitch_floor=floor, pitch_ceiling=ceiling, octave_cost=octave_cost
    )


@dataclass
class PitchTrack:
    """The pitch of a take, frame by frame.

    Attributes:
        times: Frame times in seconds.
        values: Pitch in Hz, 0 where unvoiced; subharmonic frames are already corrected.
        strength: Praat's periodicity of each frame, 0 to 1.
        subharmonic: Number of voiced frames a default tracker reads an octave low.
    """

    times: np.ndarray
    values: np.ndarray
    strength: np.ndarray
    subharmonic: int = 0

    @property
    def voiced(self) -> np.ndarray:
        """Pitch of the voiced frames."""
        return self.values[self.values > 0]


def pitch_track(sound: parselmouth.Sound, item: Item) -> PitchTrack:
    """Track the pitch and undo octave-low readings of subharmonic frames.

    In creaky voice and period doubling every second vocal-fold cycle differs, and an
    autocorrelation tracker then reports half the pitch. A voiced frame counts as such
    when it reads about half (0.45 to 0.56) of the median pitch within 0.75 s around it;
    where that neighbourhood is itself far below the take's median (under 0.7 of it),
    the take's median is the reference. Such a frame is doubled. A glide covers the
    whole range on purpose: it is tracked with a higher ceiling and left as it is.

    Args:
        sound: The take, mono.
        item: What the take contains.

    Returns:
        The corrected track, with the number of frames that Praat's default settings
        read an octave below it.
    """
    glide = item == Item.GLIDE
    pitch = track(sound, ceiling=GLIDE_CEILING_HZ if glide else PITCH_CEILING_HZ)
    result = PitchTrack(
        times=pitch.xs(),
        values=pitch.selected_array["frequency"].copy(),
        strength=pitch.selected_array["strength"],
    )
    index = np.flatnonzero(result.values > 0)
    if glide or len(index) < MIN_VOICED_FRAMES:
        return result

    times, raw = result.times[index], result.values[index]
    overall = float(np.median(raw))
    low, high = SUBHARMONIC_RATIO
    for position, (time, value) in enumerate(zip(times, raw, strict=True)):
        first, last = np.searchsorted(times, [time - CONTEXT_S, time + CONTEXT_S])
        local = float(np.median(raw[first:last]))
        reference = local if local >= LOCAL_FLOOR * overall else overall
        if low * reference <= value <= high * reference:
            result.values[index[position]] = 2.0 * value

    # what a default tracker makes of the same frames
    naive = track(sound, octave_cost=0.01)
    for frame in index:
        other = naive.get_value_at_time(float(result.times[frame]))
        value = result.values[frame]
        if not np.isnan(other) and low * value <= other <= high * value:
            result.subharmonic += 1
    return result


def pitch_metrics(pitch: PitchTrack, item: Item) -> dict[str, float]:
    """Voiced share, the pitch distribution and the share of subharmonic frames.

    Args:
        pitch: The take's pitch track.
        item: What the take contains; the distribution is reported for speech only.

    Returns:
        `voiced_share_pct` always. With at least ten voiced frames and except for a
        glide: `pitch_median_hz` and `subharmonic_share_pct`. For speech also the 5th and
        95th percentile, the range and standard deviation in semitones, and the shares of
        voiced time below, inside and above the 145–185 Hz band.
    """
    voiced = pitch.voiced
    frames = len(pitch.values)
    out = {"voiced_share_pct": 100.0 * len(voiced) / frames if frames else 0.0}
    if len(voiced) < MIN_VOICED_FRAMES or item == Item.GLIDE:
        return out
    median = float(np.median(voiced))
    out["pitch_median_hz"] = median
    out["subharmonic_share_pct"] = 100.0 * pitch.subharmonic / len(voiced)
    if item in SPEECH_ITEMS:
        p05, p95 = (float(np.percentile(voiced, p)) for p in (5, 95))
        out |= {
            "pitch_p05_hz": p05,
            "pitch_p95_hz": p95,
            "pitch_range_st": semitones(p95, p05),
            "pitch_sd_st": float((12.0 * np.log2(voiced / median)).std()),
            "pitch_below_145_pct": 100.0 * float((voiced < BAND_LOW_HZ).mean()),
            "pitch_145_185_pct": 100.0
            * float(((voiced >= BAND_LOW_HZ) & (voiced <= BAND_HIGH_HZ)).mean()),
            "pitch_above_185_pct": 100.0 * float((voiced > BAND_HIGH_HZ).mean()),
        }
    return out


def glide_metrics(pitch: PitchTrack) -> dict[str, float]:
    """The lowest and highest note of a glide, the range between them, and its breaks.

    Only clearly periodic frames count (Praat's strength of at least 0.8); the ends are
    the 2nd and 98th percentile, so single stray frames do not set them. A break is a
    jump of three semitones or more between clear frames at most 50 ms apart (a register
    flip, a yodel); jumps of about an octave are left out as octave errors of the
    tracker, and jumps within 0.25 s of a counted one belong to it.
    """
    mask = (pitch.values > 0) & (pitch.strength >= GLIDE_STRENGTH)
    clear, times = pitch.values[mask], pitch.times[mask]
    if len(clear) < MIN_VOICED_FRAMES:
        return {}
    low, high = (float(np.percentile(clear, p)) for p in (2, 98))
    breaks, last = 0, -np.inf
    for index in range(1, len(clear)):
        if times[index] - times[index - 1] > BREAK_GAP_S + 1e-9:
            continue
        jump = abs(semitones(float(clear[index]), float(clear[index - 1])))
        octave = OCTAVE_ERROR_ST[0] <= jump <= OCTAVE_ERROR_ST[1]
        if jump >= BREAK_ST and not octave and times[index] - last > BREAK_MERGE_S:
            breaks += 1
            last = times[index]
    return {
        "glide_low_hz": low,
        "glide_high_hz": high,
        "glide_range_st": semitones(high, low),
        "glide_breaks": float(breaks),
    }


def held_spread(frames: np.ndarray) -> float:
    """How far the upper formants of one held sound scatter from frame to frame, in percent.

    The geometric mean of F2 to F4 of each frame, against the sound's median: the 90th
    percentile over the 10th.

    Args:
        frames: F1 to F4 per frame, complete rows only.
    """
    upper = np.exp(np.log(frames[:, 1:4] / np.median(frames[:, 1:4], axis=0)).mean(axis=1))
    low, high = np.percentile(upper, [10, 90])
    return 100.0 * (float(high / low) - 1.0)


def formant_fit(
    sound: parselmouth.Sound, groups: list[np.ndarray], held: bool = False
) -> tuple[list[list[float]], list[float], float, float] | None:
    """Median F1 to F4 of groups of frames, with the analysis ceiling fitted to the voice.

    Burg's method finds five formants below a ceiling, so the ceiling has to sit where
    the voice has five: at five times its formant spacing. That ceiling is searched on a
    grid. Each run yields the groups' median formants and, from their mean, a spacing; the
    result is interpolated between the two neighbouring runs where "ceiling minus five
    spacings" changes sign. Runs with a median bandwidth above 500 Hz are discarded: a
    ceiling that is too low merges two formants into one wide one and then reads a short
    vocal tract as a long one. For held sounds, runs whose frames scatter (`held_spread`
    above 15%) are discarded before that: there the analysis flips between two readings
    of the same shape, and the medians of such a run are a mixture of both.

    Args:
        sound: The audio to analyse.
        groups: Frame times, one array per group: all voiced frames of a take of speech,
            or the steady middle of each sustained vowel.
        held: Each group is one held sound, whose formants should stay put.

    Returns:
        The medians per group, their mean over the groups (four frequencies in Hz each),
        the ceiling they were read at and, for held sounds, the largest spread of a
        group in the chosen run (0 for speech); `None` when no run finds all four
        formants in ten frames of every group.
    """
    # ceiling, medians, gap, width, spread
    runs: list[tuple[float, np.ndarray, float, float, float]] = []
    for ceiling in FORMANT_CEILINGS_HZ:
        formant = sound.to_formant_burg(
            time_step=TIME_STEP_S, max_number_of_formants=5, maximum_formant=ceiling
        )
        medians, widths, spreads = [], [], [0.0]
        for times in groups:
            rows = np.array(
                [
                    [formant.get_value_at_time(k, float(t)) for k in (1, 2, 3, 4)]
                    + [formant.get_bandwidth_at_time(k, float(t)) for k in (1, 2, 3, 4)]
                    for t in times
                ]
            )
            complete = rows[~np.isnan(rows).any(axis=1)] if len(rows) else rows
            if len(complete) < MIN_VOICED_FRAMES:
                break
            medians.append(np.median(complete[:, :4], axis=0))
            widths.append(np.median(complete[:, 4:], axis=0).max())
            if held:
                spreads.append(held_spread(complete[:, :4]))
        if len(medians) < len(groups) or not medians:
            continue
        overall = [float(v) for v in np.mean(medians, axis=0)]
        gap = ceiling - CEILING_PER_SPACING * spacing(overall)[0]
        runs.append((ceiling, np.array(medians), gap, float(max(widths)), max(spreads)))
    steady = [run for run in runs if run[4] <= MAX_HELD_SPREAD_PCT] or runs
    sound_runs = [run for run in steady if run[3] <= MAX_BANDWIDTH_HZ] or steady
    if not sound_runs:
        return None

    crossings = []
    for lower, upper in zip(sound_runs, sound_runs[1:], strict=False):
        adjacent = upper[0] - lower[0] <= CEILING_STEP_HZ
        if adjacent and lower[2] <= 0 <= upper[2] and lower[2] != upper[2]:
            weight = -lower[2] / (upper[2] - lower[2])
            crossings.append(
                (
                    max(lower[3], upper[3]),
                    lower[1] + weight * (upper[1] - lower[1]),
                    lower[0] + weight * (upper[0] - lower[0]),
                    max(lower[4], upper[4]),
                )
            )
    if crossings:
        _, medians, ceiling, spread = min(crossings, key=lambda crossing: crossing[0])
    else:
        ceiling, medians, _, _, spread = min(sound_runs, key=lambda run: abs(run[2]) / run[0])
    per_group = [[float(v) for v in row] for row in medians]
    return per_group, [float(v) for v in np.mean(medians, axis=0)], float(ceiling), float(spread)


def louder_voiced(sound: parselmouth.Sound, pitch: PitchTrack) -> np.ndarray:
    """Which frames of the pitch track are voiced and among the louder ones: the vowels.

    A frame counts when it is voiced and at least as loud as the take's 60th intensity
    percentile, which keeps vowels and drops most consonants.
    """
    intensity = sound.to_intensity(minimum_pitch=75.0, time_step=TIME_STEP_S)
    threshold = float(np.percentile(intensity.values[0], 60))
    return np.array(
        [
            f > 0 and (intensity.get_value(float(t)) or -np.inf) >= threshold
            for t, f in zip(pitch.times, pitch.values, strict=True)
        ],
        dtype=bool,
    )


def resonance_metrics(
    sound: parselmouth.Sound, pitch: PitchTrack, item: Item, vowels: np.ndarray
) -> tuple[dict[str, float], float | None]:
    """Median formants of the voiced, louder frames, their spacing and the tract length.

    Of the louder voiced frames (`vowels`, see `louder_voiced`) those count that are not
    above 300 Hz in pitch, where formants cannot be measured.

    Returns:
        The metrics, and the ceiling the formants were read at (`None` without any).
    """
    times = pitch.times[vowels & (pitch.values <= FORMANT_MAX_F0_HZ)]
    if len(times) < MIN_VOICED_FRAMES:
        return {}, None
    fit = formant_fit(sound, [times])
    if fit is None:
        return {}, None
    formants = fit[1]
    width, length = spacing(formants)
    out = {"formant_spacing_hz": width, "vtl_cm": length}
    if item != Item.VOWELS:
        out |= {f"f{i}_median_hz": value for i, value in enumerate(formants, start=1)}
    return out, fit[2]


def voiced_only(sound: parselmouth.Sound, pitch: PitchTrack) -> parselmouth.Sound | None:
    """The voiced stretches of a take, joined; `None` when there is less than 0.3 s."""
    values, times = pitch.values, pitch.times
    parts = []
    start = None
    for index, value in enumerate(values):
        if value > 0 and start is None:
            start = index
        if (value <= 0 or index == len(values) - 1) and start is not None:
            end = index if value <= 0 else index + 1
            if times[end - 1] - times[start] >= 0.05:
                parts.append(sound.extract_part(float(times[start]), float(times[end - 1])))
            start = None
    if not parts:
        return None
    joined = parselmouth.Sound.concatenate(parts)
    return joined if joined.duration >= 0.3 else None


def quality_metrics(voiced: parselmouth.Sound) -> dict[str, float]:
    """Voice quality of voiced audio: CPPS, HNR and the spectral slope.

    CPPS uses the settings of the Acoustic Voice Quality Index; the slope compares the
    energy below 1 kHz with the energy from 1 to 4 kHz.
    """
    harmonicity = voiced.to_harmonicity_cc(time_step=TIME_STEP_S, minimum_pitch=75.0)
    ratios = harmonicity.values[0]
    cepstrogram = call(voiced, "To PowerCepstrogram", 60, 0.002, 5000, 50)
    cpps = call(
        cepstrogram, "Get CPPS", False, 0.01, 0.001, 60, 330, 0.05, "Parabolic", 0.001, 0,
        "Straight", "Robust",
    )  # fmt: skip
    ltas = call(voiced, "To Ltas", 100)
    out = {
        "cpps_db": float(cpps),
        "spectral_slope_db": float(call(ltas, "Get slope", 0, 1000, 1000, 4000, "energy")),
    }
    audible = ratios[ratios > -100]
    if len(audible):
        out["hnr_db"] = float(np.median(audible))
    return {key: value for key, value in out.items() if np.isfinite(value)}


def vowel_segments(
    sound: parselmouth.Sound, pitch: PitchTrack, classify: bool = True
) -> tuple[list[VowelSegment], list[float] | None, list[float | None]]:
    """The sustained vowels, or held sounds, of a take: voiced stretches of at least 1.5 s.

    Each is measured over its steady middle (the central 60%). For the vowels of one
    voice (`classify`) one formant ceiling is fitted for the take, on their mean formants;
    held sounds that differ on purpose (dark, bright) are fitted one by one. A sound
    pitched above 300 Hz gets no formants: they cannot be measured there. The vowel is
    guessed from the first two formants: a high F1 is "a", otherwise a high F2 is "i",
    otherwise "u".

    Args:
        sound: The take.
        pitch: Its pitch track.
        classify: Guess which vowel each is; off for held sounds that need not be a, i, u.

    Returns:
        The segments in order, the mean of the formants of those that could be measured
        (`None` without any), and the ceiling each segment's formants were read at (`None`
        for one without formants).
    """
    values, times = pitch.values, pitch.times
    runs: list[tuple[int, int]] = []
    start = None
    for index, value in enumerate(values):
        if value > 0 and start is None:
            start = index
        if (value <= 0 or index == len(values) - 1) and start is not None:
            end = index if value <= 0 else index + 1
            # a dropout shorter than 0.15 s does not end a vowel
            if runs and times[start] - times[runs[-1][1] - 1] < 0.15:
                runs[-1] = (runs[-1][0], end)
            else:
                runs.append((start, end))
            start = None
    middles = []
    for first, last in runs:
        begin, finish = float(times[first]), float(times[last - 1])
        duration = finish - begin
        if duration >= MIN_VOWEL_S:
            middles.append((begin, duration, begin + 0.2 * duration, finish - 0.2 * duration))
    if not middles:
        return [], None, []
    pitches = []
    for _, _, a, b in middles:
        inside = values[(times >= a) & (times <= b)]
        inside = inside[inside > 0]
        pitches.append(float(np.median(inside)) if len(inside) else 0.0)
    groups = {
        index: np.arange(a, b, TIME_STEP_S)
        for index, (_, _, a, b) in enumerate(middles)
        if 0 < pitches[index] <= FORMANT_MAX_F0_HZ
    }
    formants: dict[int, list[float]] = {}
    ceilings: dict[int, float] = {}
    spreads: dict[int, float] = {}
    if classify and groups:
        fit = formant_fit(sound, list(groups.values()), held=True)
        if fit is not None:
            formants = dict(zip(groups, fit[0], strict=True))
            ceilings = dict.fromkeys(groups, fit[2])
            spreads = dict.fromkeys(groups, fit[3])
    else:
        for index, group in groups.items():
            fit = formant_fit(sound, [group], held=True)
            if fit is not None:
                formants[index], ceilings[index], spreads[index] = fit[1], fit[2], fit[3]
    if classify and not formants:
        return [], None, []
    segments = []
    for index, (begin, duration, a, b) in enumerate(middles):
        quality = quality_metrics(sound.extract_part(a, b))
        found = formants.get(index, [])
        vowel = None
        if classify and found:
            vowel = "a" if found[0] > 550 else ("i" if found[1] > 1700 else "u")
        segments.append(
            VowelSegment(
                start_s=begin,
                duration_s=duration,
                vowel=vowel,
                pitch_hz=pitches[index],
                formants_hz=found,
                cpps_db=quality.get("cpps_db", 0.0),
                hnr_db=quality.get("hnr_db", 0.0),
                formant_spread_pct=spreads.get(index),
            )
        )
    read_at = [ceilings.get(index) for index in range(len(middles))]
    if classify:
        read_at = [c for c, segment in zip(read_at, segments, strict=True) if segment.formants_hz]
        segments = [segment for segment in segments if segment.formants_hz]
    mean = [float(v) for v in np.mean(list(formants.values()), axis=0)] if formants else None
    return segments, mean, read_at


@dataclass
class Tracks:
    """A take frame by frame, on the times of its pitch track.

    Attributes:
        level: Level of each frame in dBFS (RMS over 30 ms).
        formants: F1 to F4 of each frame, one row per frame; NaN where none were read.
        lead: How far the fundamental stands above the second harmonic, in dB; NaN where
            unvoiced, and on the frames the stored traces skip.
        cpp: Cepstral peak prominence of the same frames, in dB.
    """

    level: np.ndarray
    formants: np.ndarray
    lead: np.ndarray
    cpp: np.ndarray


def frame_levels(samples: np.ndarray, sample_rate: float, times: np.ndarray) -> np.ndarray:
    """The level around each time: RMS over 30 ms, in dBFS, floored at -120."""
    half = int(LEVEL_WINDOW_S * sample_rate / 2)
    power = np.concatenate([[0.0], np.cumsum(np.asarray(samples, dtype=float) ** 2)])
    centre = (times * sample_rate).astype(int)
    first = np.clip(centre - half, 0, len(samples))
    last = np.clip(centre + half, 0, len(samples))
    mean = (power[last] - power[first]) / np.maximum(last - first, 1)
    return 10.0 * np.log10(np.maximum(mean, 1e-12))


def formant_frames(sound: parselmouth.Sound, times: np.ndarray, ceiling: float) -> np.ndarray:
    """F1 to F4 at each time, read below `ceiling`; a row is NaN unless all four exist."""
    formant = sound.to_formant_burg(
        time_step=TIME_STEP_S, max_number_of_formants=5, maximum_formant=ceiling
    )
    rows = np.array(
        [[formant.get_value_at_time(k, float(t)) for k in (1, 2, 3, 4)] for t in times]
    ).reshape(len(times), 4)
    rows[np.isnan(rows).any(axis=1)] = np.nan
    return rows


def source_frames(
    samples: np.ndarray, sample_rate: float, times: np.ndarray, pitch: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """What the spectrum of each voiced frame says about the source of the voice.

    From a 50 ms window around each time: how far the fundamental stands above the second
    harmonic (uncorrected: a first resonance close to either harmonic shifts it, so it is
    compared on the same sound or the same words only), and the cepstral peak prominence
    (the height of the cepstrum's peak at the pitch period above its trend between 1 and
    20 ms), which falls when breath or roughness blur the harmonics.

    Args:
        samples: The take, mono.
        sample_rate: Samples per second.
        times: Frame times.
        pitch: The pitch at each time, 0 where unvoiced.

    Returns:
        The two values per frame, NaN where unvoiced or too close to an end of the take.
    """
    size = int(SOURCE_WINDOW_S * sample_rate)
    padded = 1 << int(np.ceil(np.log2(4 * size)))
    window = np.hanning(size)
    freqs = np.fft.rfftfreq(padded, 1.0 / sample_rate)
    quefrency = np.arange(padded // 2) / sample_rate
    trend = (quefrency >= 0.001) & (quefrency <= 0.02)
    design = np.vstack([quefrency[trend], np.ones(int(trend.sum()))]).T
    solve = np.linalg.pinv(design)
    lead = np.full(len(times), np.nan)
    cpp = np.full(len(times), np.nan)
    for index in np.flatnonzero(pitch > 0):
        start = int(times[index] * sample_rate) - size // 2
        if start < 0 or start + size > len(samples):
            continue
        spectrum = np.abs(np.fft.rfft(samples[start : start + size] * window, padded))

        def peak(centre: float, spectrum: np.ndarray = spectrum) -> float:
            low, high = np.searchsorted(freqs, [0.9 * centre, 1.1 * centre])
            return float(spectrum[low : max(high, low + 1)].max())

        first, second = peak(pitch[index]), peak(2.0 * pitch[index])
        if first > 0 and second > 0:
            lead[index] = 20.0 * np.log10(first / second)
        cepstrum = np.fft.irfft(2.0 * np.log(np.maximum(spectrum, 1e-12)))[: padded // 2]
        levels = 20.0 * np.log10(np.maximum(np.abs(cepstrum), 1e-12))
        period = 1.0 / pitch[index]
        low, high = np.searchsorted(quefrency, [period / 1.1, period * 1.1])
        if low >= len(levels) or not trend.any():
            continue
        at = low + int(np.argmax(levels[low : max(high, low + 1)]))
        slope, offset = solve @ levels[trend]
        cpp[index] = levels[at] - (slope * quefrency[at] + offset)
    return lead, cpp


def measure_tracks(
    sound: parselmouth.Sound,
    pitch: PitchTrack,
    item: Item,
    ceiling: float | None,
    segments: list[VowelSegment],
    ceilings: list[float | None],
) -> Tracks:
    """Measure a take frame by frame.

    Formants are read on the voiced frames up to 300 Hz of pitch: for speech and a set of
    vowels at the ceiling fitted to the take, inside a held sound of a `sustain` take at
    that sound's own. Everything else of a `sustain` take (a whisper, a short voiced bit)
    is read at 5500 Hz, on the frames that sound (see `whisper_frames`).

    Args:
        sound: The take, mono.
        pitch: Its pitch track.
        item: What the take contains.
        ceiling: The ceiling fitted to the take (speech, vowels); `None` without one.
        segments: The held sounds of the take.
        ceilings: The ceiling of each held sound; `None` for one without formants.
    """
    samples, rate = sound.values[0], sound.sampling_frequency
    times, values = pitch.times, pitch.values
    level = frame_levels(samples, rate, times)
    formants = np.full((len(times), 4), np.nan)
    readable = voiced_frames(values)
    if item == Item.SUSTAIN:
        loose = readable | whisper_frames(level, values)
        for segment, read_at in zip(segments, ceilings, strict=True):
            inside = (times >= segment.start_s) & (times <= segment.start_s + segment.duration_s)
            loose &= ~inside
            if read_at is not None:
                chosen = inside & readable
                formants[chosen] = formant_frames(sound, times[chosen], read_at)
        if loose.any():
            formants[loose] = formant_frames(sound, times[loose], LOOSE_CEILING_HZ)
    elif ceiling is not None and readable.any():
        formants[readable] = formant_frames(sound, times[readable], ceiling)
    kept = np.zeros(len(times), dtype=bool)
    kept[::TRACE_EVERY] = True
    lead, cpp = source_frames(samples, rate, times, np.where(kept, values, 0.0))
    return Tracks(level=level, formants=formants, lead=lead, cpp=cpp)


def voiced_frames(pitch: np.ndarray) -> np.ndarray:
    """Which frames carry a voice whose resonances can be read: a pitch up to 300 Hz.

    Noise now and then reads as a "pitch" of several hundred Hz; in a take that may be a
    whisper such frames are noise.
    """
    return (pitch > 0) & (pitch <= FORMANT_MAX_F0_HZ)


def whisper_frames(level: np.ndarray, pitch: np.ndarray) -> np.ndarray:
    """Which unvoiced frames sound: within 15 dB of the loudest of them, clear of the room.

    The loudest is the 98th percentile of the unvoiced frames' levels; the room is the 5th
    percentile of all frames, and a frame has to stand 12 dB above it, so the steady noise
    of a silent stretch never counts. The frames either side of a voiced stretch are left
    out, where a voice starts or stops: three of them, and 0.2 s around a stretch of a
    quarter of a second or more, which is a voice and not a blip of the tracker.
    """
    voiced = voiced_frames(pitch)
    lasting = np.zeros_like(voiced)
    turns = np.flatnonzero(np.diff(np.concatenate(([0], voiced.astype(np.int8), [0]))))
    for start, stop in zip(turns[::2], turns[1::2], strict=True):
        lasting[start:stop] = stop - start >= WHISPER_VOICE_FRAMES
    near = voiced.copy()
    for mask, reach in ((voiced, WHISPER_EDGE_FRAMES), (lasting, WHISPER_VOICE_EDGE_FRAMES)):
        for shift in range(1, reach + 1):
            near[shift:] |= mask[:-shift]
            near[:-shift] |= mask[shift:]
    unvoiced = ~near
    if not unvoiced.any():
        return unvoiced
    top = float(np.percentile(level[unvoiced], 98))
    floor = float(np.percentile(level, 5))
    return unvoiced & (level >= top - WHISPER_GATE_DB) & (level >= floor + WHISPER_CLEAR_DB)


def whisper_spans(times: np.ndarray, pitch: np.ndarray, tracks: Tracks) -> list[WhisperSpan]:
    """The whispered seconds of a take: where it sounds without a voice.

    A take counts as whispered when at least a fifth of its sounding frames (voiced, or
    unvoiced and sounding) are unvoiced; a voiced take's breaths stay below that. Each
    second with at least eight whispered frames whose formants were found is reported
    with their median.
    """
    found = ~np.isnan(tracks.formants).any(axis=1)
    whispered = whisper_frames(tracks.level, pitch) & found
    sounding = int(whispered.sum()) + int(voiced_frames(pitch).sum())
    if not sounding or whispered.sum() < WHISPER_MIN_SHARE * sounding:
        return []
    spans = []
    for start in np.arange(0.0, float(times[-1]), WHISPER_SPAN_S):
        chosen = whispered & (times >= start) & (times < start + WHISPER_SPAN_S)
        if chosen.sum() >= WHISPER_MIN_FRAMES:
            spans.append(
                WhisperSpan(
                    start_s=float(start),
                    duration_s=WHISPER_SPAN_S,
                    formants_hz=[float(v) for v in np.median(tracks.formants[chosen], axis=0)],
                )
            )
    return spans


def unreadable_share(formants: np.ndarray, pitch: np.ndarray, lead: np.ndarray) -> float | None:
    """The share of frames, in percent, whose F1 cannot be told from the pitch.

    A frame counts when its F1 lies below 1.25 times the pitch, or below 1.75 times the
    pitch while the fundamental leads the second harmonic by 12 dB or more: there the
    analysis has found the fundamental, or a point between it and the first resonance.

    Args:
        formants: F1 to F4 per frame.
        pitch: The pitch of the same frames.
        lead: How far the fundamental stands above the second harmonic in each.

    Returns:
        The share among the frames that have all three; `None` with fewer than ten.
    """
    found = ~np.isnan(formants[:, 0]) & (pitch > 0) & ~np.isnan(lead)
    if found.sum() < MIN_VOICED_FRAMES:
        return None
    ratio = formants[found, 0] / pitch[found]
    doubtful = (ratio < PITCH_RATIO) | ((ratio < NEAR_RATIO) & (lead[found] >= DOMINANT_DB))
    return 100.0 * float(doubtful.mean())


def median_of(values: np.ndarray) -> float | None:
    """The median of the values that were measured; `None` with fewer than ten."""
    kept = values[~np.isnan(values)]
    return float(np.median(kept)) if len(kept) >= MIN_VOICED_FRAMES else None


def stored(times: np.ndarray, values: np.ndarray, decimals: int) -> Series:
    """A track as it is stored: every second frame, rounded, `None` where unmeasured."""
    kept = values[::TRACE_EVERY]
    return Series(
        start_s=float(times[0]),
        step_s=TIME_STEP_S * TRACE_EVERY,
        values=[None if np.isnan(v) else round(float(v), decimals) for v in kept],
    )


def analyse(path: Path, item: Item) -> Analysis:
    """Measure one take.

    Args:
        path: The recording (any format Praat reads; the API serves FLAC).
        item: What the take contains; it decides which measures apply.

    Returns:
        The metrics by registry key, the structured details, and the stored series.

    Raises:
        parselmouth.PraatError: The file cannot be read as audio.
    """
    sound = parselmouth.Sound(str(path))
    if sound.n_channels > 1:
        sound = sound.convert_to_mono()
    samples = sound.values[0]
    pitch = pitch_track(sound, item)
    result = Analysis(
        metrics={
            "duration_s": float(sound.duration),
            **level_metrics(samples, sound.sampling_frequency),
            **pitch_metrics(pitch, item),
        }
    )
    result.series["pitch_hz"] = Series(
        start_s=float(pitch.times[0]) if len(pitch.times) else 0.0,
        step_s=TIME_STEP_S,
        values=[round(float(v), 1) if v > 0 else None for v in pitch.values],
    )
    times, values = pitch.times, pitch.values
    has_voice = len(pitch.voiced) >= MIN_VOICED_FRAMES
    if item == Item.GLIDE:
        if has_voice:
            result.metrics |= glide_metrics(pitch)
        return result
    if not len(times):
        return result
    if not has_voice and item != Item.SUSTAIN:
        # nothing to measure but how loud it was; a `sustain` take may be a whisper
        result.series["level_db"] = stored(
            times, frame_levels(samples, sound.sampling_frequency, times), 1
        )
        return result

    segments: list[VowelSegment] = []
    ceilings: list[float | None] = []
    ceiling = None
    vowels = louder_voiced(sound, pitch) if has_voice else np.zeros(len(times), dtype=bool)
    if has_voice and item in (Item.VOWELS, Item.SUSTAIN):
        segments, mean_formants, ceilings = vowel_segments(
            sound, pitch, classify=item == Item.VOWELS
        )
        if item == Item.VOWELS:
            result.details.vowels = segments
            ceiling = next((c for c in ceilings if c is not None), None)
        else:
            result.details.segments = segments
        if mean_formants is not None:
            # the tract length of a set of vowels: the spacing of their mean formants
            width, length = spacing(mean_formants)
            result.metrics |= {"formant_spacing_hz": width, "vtl_cm": length}
    elif has_voice:
        found, ceiling = resonance_metrics(sound, pitch, item, vowels)
        result.metrics |= found

    voiced = voiced_only(sound, pitch)
    if voiced is not None:
        result.metrics |= quality_metrics(voiced)

    tracks = measure_tracks(sound, pitch, item, ceiling, segments, ceilings)
    counted = vowels
    if segments:
        # held sounds are read over their steady middle, as their formants are
        counted = np.zeros(len(times), dtype=bool)
        for segment in segments:
            first = segment.start_s + 0.2 * segment.duration_s
            last = segment.start_s + 0.8 * segment.duration_s
            middle = (times >= first) & (times <= last)
            counted |= middle
            lead = median_of(tracks.lead[middle])
            segment.h1h2_db = lead
            segment.r1_unreadable_pct = unreadable_share(
                tracks.formants[middle], values[middle], tracks.lead[middle]
            )
    lightness = median_of(tracks.lead[counted])
    if lightness is not None:
        result.metrics["lightness_db"] = lightness
    if item in SPEECH_ITEMS:
        unreadable = unreadable_share(
            tracks.formants[counted], values[counted], tracks.lead[counted]
        )
        if unreadable is not None:
            result.metrics["r1_unreadable_pct"] = unreadable
    if item == Item.SUSTAIN:
        result.details.whisper = whisper_spans(times, values, tracks)
    result.series["level_db"] = stored(times, tracks.level, 1)
    if not np.isnan(tracks.formants).all():
        for index in range(4):
            result.series[f"f{index + 1}_hz"] = stored(times, tracks.formants[:, index], 0)
    result.series["h1h2_db"] = stored(times, tracks.lead, 1)
    result.series["cpp_db"] = stored(times, tracks.cpp, 1)
    return result
