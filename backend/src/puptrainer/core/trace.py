"""A take moment by moment: its stored series turned into rows that can be drawn.

The pipeline stores what it measures frame by frame (pitch, level, formants, the lead of
the fundamental, cepstral peak prominence). This module bins those into tenths of a
second and, for held sounds and whispers, counts the resonances from the take's own first
sound, as the judging of such takes does. Like readings it is pure, runs when a trace is
asked for, and nothing of it is stored.
"""

from collections.abc import Mapping

import numpy as np

from puptrainer.core.acoustics import (
    PITCH_RATIO,
    R1_MAX_LIGHTNESS_DB,
    brightness_pct,
    first_pct,
)
from puptrainer.core.schemas import (
    Details,
    Item,
    Series,
    Trace,
    TraceRow,
    TraceSpan,
    TraceZero,
)

STEP_S = 0.1
MIN_SHARE = 0.3
"""The share of a step's frames that must hold a value for the step to have one."""
LEAD_SPANS = 3
"""The whispered seconds at the start of a take that make its zero (as `WhisperRule`)."""
MAX_PITCH_HZ = 300.0
SMOOTH_STEPS = 2
"""Steps either side over which the lead of the fundamental is smoothed before it decides
whether the first resonance can be read: a sound near the limit should not flicker."""
FORMANTS = ("f1_hz", "f2_hz", "f3_hz", "f4_hz")


def _binned(series: Series | None, steps: int) -> np.ndarray:
    """A stored series as one median per step; NaN where too few frames hold a value."""
    out = np.full(steps, np.nan)
    if series is None or not series.values:
        return out
    values = np.array([np.nan if v is None else v for v in series.values], dtype=float)
    times = series.start_s + series.step_s * np.arange(len(values))
    index = np.floor(times / STEP_S + 1e-9).astype(int)
    need = max(1, int(np.ceil(MIN_SHARE * STEP_S / series.step_s)))
    for step in range(steps):
        inside = values[index == step]
        kept = inside[~np.isnan(inside)]
        if len(kept) >= need:
            out[step] = float(np.median(kept))
    return out


def _zero(details: Details) -> tuple[TraceZero, list[float]] | None:
    """What a `sustain` take's resonances are counted from: its first sound."""
    held = [s for s in details.segments if len(s.formants_hz) == 4]
    spans = details.whisper
    whispered = len(spans) >= LEAD_SPANS
    if whispered and (not held or spans[0].start_s < held[0].start_s):
        lead = np.median([s.formants_hz for s in spans[:LEAD_SPANS]], axis=0)
        return TraceZero.FIRST_WHISPER, [float(v) for v in lead]
    if held:
        return TraceZero.FIRST_SOUND, list(held[0].formants_hz)
    return None


def _spans(details: Details) -> list[TraceSpan]:
    spans = [
        TraceSpan(start_s=s.start_s, end_s=s.start_s + s.duration_s, kind="held")
        for s in details.segments
    ]
    run: TraceSpan | None = None
    for span in details.whisper:
        if run is not None and abs(span.start_s - run.end_s) < 1e-6:
            run.end_s = span.start_s + span.duration_s
            continue
        run = TraceSpan(start_s=span.start_s, end_s=span.start_s + span.duration_s, kind="whisper")
        spans.append(run)
    return sorted(spans, key=lambda s: s.start_s)


def _row(key: str, values: np.ndarray, decimals: int) -> TraceRow:
    return TraceRow(
        key=key, values=[None if np.isnan(v) else round(float(v), decimals) for v in values]
    )


def trace(item: Item, series: Mapping[str, Series], details: Details) -> Trace:
    """A take as rows over time, a value every tenth of a second.

    Pitch, lightness (the lead of the fundamental), clarity (cepstral peak prominence)
    and level are the medians of the frames in each step. For a `sustain` take the
    resonances are counted from its first sound (`_zero`): brightness (F2 to F4) and the
    first resonance, in percent; a whispered second is one value across the second.
    Where a voice is so light that its first resonance cannot be read (the fundamental
    leads by 12 dB or more, or the reading lies at the pitch), `r1_pct` is left out and
    the step is marked.

    Args:
        item: What the take contains.
        series: Its stored series by key; a take analysed by an older pipeline has
            `pitch_hz` only and yields that row alone.
        details: Its held sounds and whispered seconds.

    Returns:
        The rows that could be made, in drawing order; empty without any series.
    """
    ends = [s.start_s + s.step_s * len(s.values) for s in series.values() if s.values]
    steps = int(np.ceil(max(ends) / STEP_S - 1e-9)) if ends else 0
    pitch = _binned(series.get("pitch_hz"), steps)
    lead = _binned(series.get("h1h2_db"), steps)
    clarity = _binned(series.get("cpp_db"), steps)
    formants = np.stack([_binned(series.get(key), steps) for key in FORMANTS], axis=1)
    # NOTE: where a voice starts and stops, half a step is not voice yet: the source and
    # the resonances read wildly there, so the first and last step of a voiced run go
    sung = ~np.isnan(pitch)
    edge = sung & ~(np.r_[False, sung[:-1]] & np.r_[sung[1:], False])
    lead[edge] = clarity[edge] = np.nan
    formants[edge] = np.nan
    if item == Item.SUSTAIN:
        # NOTE: a whisper comes in puffs a quarter of a second long: step by step it is
        # scattered dots. Each whispered second is drawn as what it was measured as, one
        # value across the second; a voice inside it keeps its own steps
        centres = STEP_S * (np.arange(steps) + 0.5)
        for span in details.whisper:
            inside = (centres >= span.start_s) & (centres < span.start_s + span.duration_s)
            formants[inside & ~sung] = span.formants_hz
    rows: list[TraceRow] = []
    unreadable = np.zeros(steps, dtype=bool)
    if not np.isnan(pitch).all():
        rows.append(_row("pitch_hz", pitch, 1))
    zero = _zero(details) if item == Item.SUSTAIN else None
    if zero is not None and steps and not np.isnan(formants).all():
        found = ~np.isnan(formants).any(axis=1)
        bright = np.full(steps, np.nan)
        first = np.full(steps, np.nan)
        for step in np.flatnonzero(found):
            bright[step] = brightness_pct(formants[step], zero[1])
            first[step] = first_pct(formants[step], zero[1])
        smooth = np.array(
            [
                np.nan
                if np.isnan(lead[max(0, i - SMOOTH_STEPS) : i + SMOOTH_STEPS + 1]).all()
                else np.nanmedian(lead[max(0, i - SMOOTH_STEPS) : i + SMOOTH_STEPS + 1])
                for i in range(steps)
            ]
        )
        voiced = found & (pitch > 0) & (pitch <= MAX_PITCH_HZ)
        with np.errstate(invalid="ignore"):
            light = voiced & (smooth >= R1_MAX_LIGHTNESS_DB)
            at_pitch = voiced & (formants[:, 0] < PITCH_RATIO * pitch)
        unreadable = light | at_pitch
        first[unreadable] = np.nan
        rows += [_row("brightness_pct", bright, 1), _row("r1_pct", first, 1)]
    else:
        zero = None
    if not np.isnan(lead).all():
        rows.append(_row("lightness_db", lead, 1))
    if not np.isnan(clarity).all():
        rows.append(_row("clarity_db", clarity, 1))
    level = _binned(series.get("level_db"), steps)
    if not np.isnan(level).all():
        rows.append(_row("level_db", level, 1))
    return Trace(
        start_s=STEP_S / 2,
        step_s=STEP_S,
        rows=rows,
        r1_unreadable=[bool(v) for v in unreadable],
        zero=None if zero is None else zero[0],
        spans=_spans(details) if item == Item.SUSTAIN else [],
    )
