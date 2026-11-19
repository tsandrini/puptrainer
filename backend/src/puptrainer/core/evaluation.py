"""Judging practice takes: an exercise's rule applied to a take's measurements.

The pipeline measures sounds and knows nothing of exercises; this module judges a take
by the rule of the exercise it was recorded for, against the target it was recorded
with. It is pure and cheap, so the API runs it whenever it serves a take and nothing of
it is stored: a changed rule or a re-analysed take is judged anew.
"""

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

from puptrainer.core.acoustics import cents, semitones, spacing
from puptrainer.core.schemas import (
    Advice,
    Evaluation,
    EvaluationProblem,
    Exercise,
    Measure,
    MeasureDef,
    MetricRule,
    NoRule,
    PitchBandRule,
    PitchHoldRule,
    StepsRule,
    Target,
    VowelSegment,
)

MEASURES: tuple[MeasureDef, ...] = (
    MeasureDef(key="band_share_pct", unit="%", decimals=0),
    MeasureDef(key="band_up_share_pct", unit="%", decimals=0),
    MeasureDef(key="note_offset_st", unit="st", decimals=1),
    MeasureDef(key="step_first_cm", unit="cm", decimals=1),
    MeasureDef(key="step_last_cm", unit="cm", decimals=1),
    MeasureDef(key="hold_s", unit="s", decimals=1),
    MeasureDef(key="hold_pitch_hz", unit="Hz", decimals=0),
    MeasureDef(key="hold_offset_cents", unit="cents", decimals=0),
    MeasureDef(key="steps_found", unit="", decimals=0),
    MeasureDef(key="step_rise_pct", unit="%", decimals=1),
    MeasureDef(key="step_drift_st", unit="st", decimals=1),
)
"""Every key a judgement may report besides registry metrics; texts in `content/measures`."""

MIN_VOICED_FRAMES = 10
HOLD_GAP_S = 0.05
STRAINED = 1
"""The lowest comfort rating: a rep rated so is never met."""
EFFORTFUL = 2
"""The comfort rating that still counts, with the advice to go easier."""
SIZE_KEYS = frozenset({"vtl_cm"})
FORMANT_MAX_F0_HZ = 300.0
"""Above this pitch the pipeline measures no formants (see `analysis.pipeline`)."""
"""Hints read against the learner's baseline size."""


@dataclass
class TakeFacts:
    """What a take offers to be judged on.

    Attributes:
        analysed: Whether an analysis has finished.
        metrics: Its metrics by registry key.
        pitch: Its stored pitch contour (`None` where unvoiced), if any.
        step_s: Time between the contour's values.
        segments: The held sounds of a `sustain` take.
        target: The band, and the note, it was recorded against.
        comfort: How the rep felt, 1 (strained) to 5.
        baseline_cm: The apparent tract length of the learner's everyday voice in a
            comparable kind of take on the same microphone setup, if known.
    """

    analysed: bool
    metrics: dict[str, float] = field(default_factory=dict)
    pitch: list[float | None] | None = None
    step_s: float = 0.01
    segments: list[VowelSegment] = field(default_factory=list)
    target: Target | None = None
    comfort: int | None = None
    baseline_cm: float | None = None


def needs_pitch(exercise: Exercise | None) -> bool:
    """Whether judging this exercise reads the pitch contour (worth loading)."""
    return exercise is not None and isinstance(exercise.rule, PitchBandRule | PitchHoldRule)


def evaluate(exercise_ref: str, exercise: Exercise | None, facts: TakeFacts) -> Evaluation:
    """Judge one take of an exercise.

    Args:
        exercise_ref: The reference the take carries (`exercise:note-match@1`).
        exercise: The exercise as the catalogue has it now; `None` when it is gone.
        facts: The take's measurements and target.

    Returns:
        The judgement: met or not, the numbers it rests on, the exercise's hints, or the
        problem that kept it from being judged. A rep rated strained is never met.
    """
    if exercise is None:
        return Evaluation(
            exercise_ref=exercise_ref, rule="unknown", problem=EvaluationProblem.UNKNOWN_EXERCISE
        )
    rule = exercise.rule
    out = Evaluation(exercise_ref=exercise_ref, rule=rule.kind)
    if not facts.analysed:
        out.problem = EvaluationProblem.NOT_ANALYSED
        return out
    out.hints = [
        Measure(
            key=k,
            value=facts.metrics[k],
            baseline=facts.baseline_cm if k in SIZE_KEYS else None,
        )
        for k in exercise.hints
        if k in facts.metrics
    ]
    median = facts.metrics.get("pitch_median_hz", 0.0)
    if SIZE_KEYS & set(exercise.hints) - set(facts.metrics) and median > FORMANT_MAX_F0_HZ:
        out.advice.append(Advice.PITCH_TOO_HIGH)
    match rule:
        case NoRule():
            pass
        case PitchBandRule():
            _pitch_band(rule, facts, out)
        case PitchHoldRule():
            _pitch_hold(rule, facts, out)
        case MetricRule():
            _metric(rule, facts, out)
        case StepsRule():
            _steps(rule, facts, out)
    if out.met and facts.comfort == STRAINED:
        out.met, out.strained = False, True
    if out.met and facts.comfort == EFFORTFUL:
        out.advice.append(Advice.EFFORTFUL)
    return out


def _voiced(facts: TakeFacts) -> np.ndarray | None:
    if facts.pitch is None:
        return None
    return np.array([v for v in facts.pitch if v is not None and v > 0], dtype=float)


def _pitch_band(rule: PitchBandRule, facts: TakeFacts, out: Evaluation) -> None:
    if facts.target is None:
        out.problem = EvaluationProblem.NO_BAND
        return
    voiced = _voiced(facts)
    if voiced is None:
        out.problem = EvaluationProblem.NOT_MEASURED
        return
    if len(voiced) < MIN_VOICED_FRAMES:
        out.problem = EvaluationProblem.TOO_LITTLE_VOICE
        return
    low, high = facts.target.band_low_hz, facts.target.band_high_hz
    inside = voiced >= low if rule.above_ok else (voiced >= low) & (voiced <= high)
    share = 100.0 * float(inside.mean())
    median = float(np.median(voiced))
    out.met = share >= rule.min_share_pct
    out.measures = [
        Measure(
            key="band_up_share_pct" if rule.above_ok else "band_share_pct",
            value=share,
            low=rule.min_share_pct,
            met=out.met,
        ),
        Measure(key="pitch_median_hz", value=median, low=low, high=high),
    ]
    if not out.met:
        _where(median, low, None if rule.above_ok else high, out)


def _where(pitch: float, low: float, high: float | None, out: Evaluation) -> bool:
    """Say on which side of a range the pitch sat; whether it was outside at all."""
    if pitch < low:
        out.advice.append(Advice.BELOW_BAND)
    elif high is not None and pitch > high:
        out.advice.append(Advice.ABOVE_BAND)
    else:
        return False
    return True


def _pitch_hold(rule: PitchHoldRule, facts: TakeFacts, out: Evaluation) -> None:
    target = facts.target
    if target is None:
        out.problem = EvaluationProblem.NO_BAND
        return
    if rule.at == "note" and target.note_hz is None:
        out.problem = EvaluationProblem.NO_NOTE
        return
    if facts.pitch is None:
        out.problem = EvaluationProblem.NOT_MEASURED
        return
    voiced = _voiced(facts)
    if voiced is None or len(voiced) < MIN_VOICED_FRAMES:
        out.problem = EvaluationProblem.TOO_LITTLE_VOICE
        return
    if rule.at == "note" and target.note_hz is not None:
        factor = 2 ** (rule.tolerance_cents / 1200)
        low, high = target.note_hz / factor, target.note_hz * factor
    else:
        low, high = target.band_low_hz, target.band_high_hz

    note = target.note_hz if rule.at == "note" else None
    median = float(np.median(voiced))
    hold = steady_hold(facts.pitch, low, high, rule.spread_cents, facts.step_s)
    seconds, pitch = hold if hold is not None else (0.0, median)
    out.met = seconds >= rule.min_hold_s
    out.measures = [Measure(key="hold_s", value=seconds, low=rule.min_hold_s, met=out.met)]
    if note is not None and hold is not None:
        out.measures.append(
            Measure(
                key="hold_offset_cents",
                value=cents(pitch, note),
                low=-rule.tolerance_cents,
                high=rule.tolerance_cents,
            )
        )
    elif note is not None:
        # nothing was held near the note: say how far off the voice was
        limit = rule.tolerance_cents / 100
        out.measures.append(
            Measure(key="note_offset_st", value=semitones(median, note), low=-limit, high=limit)
        )
    elif hold is not None:
        out.measures.append(Measure(key="hold_pitch_hz", value=pitch, low=low, high=high))
    else:
        out.measures.append(Measure(key="pitch_median_hz", value=median, low=low, high=high))
    if out.met:
        return
    if note is not None and hold is None:
        out.advice.append(Advice.BELOW_NOTE if median < note else Advice.ABOVE_NOTE)
    elif hold is None and _where(median, low, high, out):
        pass
    else:
        out.advice.append(Advice.UNSTEADY)


def steady_hold(
    pitch: Sequence[float | None], low: float, high: float, spread_cents: float, step_s: float
) -> tuple[float, float] | None:
    """The longest steady stretch of a contour inside a range.

    A stretch counts while every voiced frame in it lies within `low`..`high` and within
    a window of `2 * spread_cents`; frames outside the range or unvoiced end it once they
    last longer than 50 ms.

    Args:
        pitch: The contour, `None` where unvoiced.
        low: Lowest pitch inside the range, Hz.
        high: Highest pitch inside the range, Hz.
        spread_cents: How far the pitch may wander either side of the window's middle.
        step_s: Time between values.

    Returns:
        The stretch's length in seconds and its median pitch, or `None` when no frame
        lies inside the range.
    """
    max_gap = int(round(HOLD_GAP_S / step_s))
    inside = [
        (index, value)
        for index, value in enumerate(pitch)
        if value is not None and low <= value <= high
    ]
    if not inside:
        return None
    width = 2.0 * spread_cents
    best: tuple[int, int] = (0, 0)  # positions in `inside`
    left = 0
    highs: deque[int] = deque()  # positions, decreasing cents
    lows: deque[int] = deque()  # positions, increasing cents
    levels = [cents(value, low) for _, value in inside]
    for right in range(len(inside)):
        if right > 0 and inside[right][0] - inside[right - 1][0] - 1 > max_gap:
            left = right
            highs.clear()
            lows.clear()
        while highs and levels[highs[-1]] <= levels[right]:
            highs.pop()
        highs.append(right)
        while lows and levels[lows[-1]] >= levels[right]:
            lows.pop()
        lows.append(right)
        while levels[highs[0]] - levels[lows[0]] > width:
            left += 1
            while highs[0] < left:
                highs.popleft()
            while lows[0] < left:
                lows.popleft()
        span = inside[right][0] - inside[left][0]
        if span > inside[best[1]][0] - inside[best[0]][0]:
            best = (left, right)
    first, last = best
    values = [value for _, value in inside[first : last + 1]]
    seconds = (inside[last][0] - inside[first][0] + 1) * step_s
    return seconds, float(np.median(values))


def _metric(rule: MetricRule, facts: TakeFacts, out: Evaluation) -> None:
    value = facts.metrics.get(rule.key)
    if value is None:
        out.problem = EvaluationProblem.NOT_MEASURED
        return
    met = (rule.below is None or value <= rule.below) and (
        rule.above is None or value >= rule.above
    )
    out.met = met
    out.measures = [Measure(key=rule.key, value=value, low=rule.above, high=rule.below, met=met)]


def _steps(rule: StepsRule, facts: TakeFacts, out: Evaluation) -> None:
    held = [s for s in facts.segments if s.pitch_hz > 0]
    if len(held) < rule.count:
        out.met = False
        out.measures = [
            Measure(key="steps_found", value=float(len(held)), low=rule.count, met=False)
        ]
        return
    # NOTE: more held sounds than asked for (a cough, a restart): the longest ones count
    chosen = sorted(
        sorted(held, key=lambda s: s.duration_s)[-rule.count :], key=lambda s: s.start_s
    )
    pitches = [s.pitch_hz for s in chosen]
    drift = semitones(max(pitches), min(pitches))
    steady = drift <= rule.max_drift_st
    out.measures = [Measure(key="step_drift_st", value=drift, high=rule.max_drift_st, met=steady)]
    if not steady:
        out.advice.append(Advice.PITCH_MOVED)
    if not all(len(s.formants_hz) == 4 for s in chosen):
        # a sound pitched too high to show its resonances: nothing to compare
        out.met = False
        out.advice.append(Advice.PITCH_TOO_HIGH)
        return
    widths = [spacing(s.formants_hz)[0] for s in chosen]
    lengths = [spacing(s.formants_hz)[1] for s in chosen]
    rising = all(b > a for a, b in zip(widths, widths[1:], strict=False))
    out.met = rising and steady
    if steady and not rising:
        out.advice.append(Advice.NOT_BRIGHTER)
    out.measures = [
        Measure(key="step_rise_pct", value=100.0 * (widths[-1] / widths[0] - 1), met=rising),
        *out.measures,
        Measure(key="step_first_cm", value=lengths[0], baseline=facts.baseline_cm),
        Measure(key="step_last_cm", value=lengths[-1], baseline=facts.baseline_cm),
    ]
