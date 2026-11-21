import numpy as np
import pytest

from puptrainer.core.content import load_content
from puptrainer.core.evaluation import TakeFacts, evaluate, steady_hold
from puptrainer.core.schemas import (
    EvaluationProblem,
    Exercise,
    Target,
    VowelSegment,
    WhisperSpan,
)

from .conftest import CONTENT

BAND = Target(band_low_hz=170.0, band_high_hz=220.0, note_hz=None)
STEP = 0.01


@pytest.fixture(scope="module")
def catalogue() -> dict[str, Exercise]:
    return {e.id: e for e in load_content(CONTENT).exercises}


def contour(*parts: tuple[float, float, float]) -> list[float | None]:
    """Pieces of (start Hz, end Hz, seconds), log-interpolated; 0 Hz is unvoiced."""
    out: list[float | None] = []
    for start, end, seconds in parts:
        n = round(seconds / STEP)
        if start == 0:
            out += [None] * n
        else:
            out += [float(v) for v in np.geomspace(start, end, n)]
    return out


def facts(
    pitch: list[float | None] | None,
    target: Target | None = BAND,
    metrics: dict[str, float] | None = None,
    segments: list[VowelSegment] | None = None,
    whisper: list[WhisperSpan] | None = None,
) -> TakeFacts:
    return TakeFacts(
        analysed=True,
        pitch=pitch,
        step_s=STEP,
        target=target,
        metrics=metrics or {},
        segments=segments or [],
        whisper=whisper or [],
    )


def measures(evaluation) -> dict[str, float]:  # noqa: ANN001
    return {m.key: m.value for m in evaluation.measures}


def test_pitch_band_share(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["count-in-band"]
    half = contour((150, 150, 1.0), (0, 0, 0.3), (190, 190, 1.0))
    result = evaluate("exercise:count-in-band@1", exercise, facts(half))
    assert measures(result)["band_share_pct"] == pytest.approx(50.0)
    assert result.met is True  # the bar is 50%
    low = evaluate("exercise:count-in-band@1", exercise, facts(contour((150, 160, 2.0))))
    assert low.met is False
    assert measures(low)["band_share_pct"] == 0
    median = next(m for m in low.measures if m.key == "pitch_median_hz")
    assert (median.low, median.high) == (170.0, 220.0)


def test_slide_down_into_the_band_and_hold(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["slide-down-hold"]
    take = contour((320, 195, 1.2), (195, 195, 2.0), (0, 0, 0.5))
    result = evaluate("exercise:slide-down-hold@1", exercise, facts(take))
    assert result.met is True
    assert measures(result)["hold_s"] == pytest.approx(2.1, abs=0.15)
    assert measures(result)["hold_pitch_hz"] == pytest.approx(195.0, abs=1.0)
    short = contour((320, 195, 1.2), (195, 195, 0.8))
    assert evaluate("exercise:slide-down-hold@1", exercise, facts(short)).met is False
    above = contour((320, 260, 3.0))
    missed = evaluate("exercise:slide-down-hold@1", exercise, facts(above))
    assert missed.met is False
    assert measures(missed)["hold_s"] == 0
    assert measures(missed)["pitch_median_hz"] > 220


def test_a_wobbly_note_is_not_a_hold() -> None:
    t = np.arange(300) * STEP
    wobble = [float(195 * 2 ** (80 / 1200 * np.sin(2 * np.pi * 1.5 * x))) for x in t]
    steady = steady_hold(wobble, 170, 220, 50, STEP)
    assert steady is not None and steady[0] < 0.5


def test_short_dropouts_do_not_end_a_hold() -> None:
    held = contour((195, 195, 1.0), (0, 0, 0.03), (195, 195, 1.0))
    assert steady_hold(held, 170, 220, 50, STEP)[0] == pytest.approx(2.03, abs=0.02)  # type: ignore[index]
    broken = contour((195, 195, 1.0), (0, 0, 0.2), (195, 195, 1.0))
    assert steady_hold(broken, 170, 220, 50, STEP)[0] == pytest.approx(1.0, abs=0.02)  # type: ignore[index]


def test_note_match(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["note-match"]
    note = Target(band_low_hz=170.0, band_high_hz=220.0, note_hz=196.0)
    sharp = 196.0 * 2 ** (30 / 1200)
    result = evaluate("exercise:note-match@1", exercise, facts(contour((sharp, sharp, 2.5)), note))
    assert result.met is True
    assert measures(result)["hold_offset_cents"] == pytest.approx(30.0, abs=1.0)
    off = 196.0 * 2 ** (90 / 1200)
    missed = evaluate("exercise:note-match@1", exercise, facts(contour((off, off, 2.5)), note))
    assert missed.met is False
    no_note = evaluate("exercise:note-match@1", exercise, facts(contour((196, 196, 2.5))))
    assert no_note.problem == EvaluationProblem.NO_NOTE


def test_metric_rule_and_hints(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["light-hum"]
    clean = facts(None, metrics={"subharmonic_share_pct": 2.0, "hnr_db": 18.0})
    result = evaluate("exercise:light-hum@1", exercise, clean)
    assert result.met is True
    assert result.measures[0].high == 5
    assert [(h.key, h.value) for h in result.hints] == [("hnr_db", 18.0)]
    creaky = facts(None, metrics={"subharmonic_share_pct": 12.0})
    assert evaluate("exercise:light-hum@1", exercise, creaky).met is False
    unmeasured = evaluate("exercise:light-hum@1", exercise, facts(None))
    assert unmeasured.problem == EvaluationProblem.NOT_MEASURED


def segment(start: float, spacing_hz: float, pitch: float, seconds: float = 2.5) -> VowelSegment:
    formants = [spacing_hz * (2 * i - 1) / 2 for i in range(1, 5)]
    return VowelSegment(
        start_s=start, duration_s=seconds, pitch_hz=pitch, formants_hz=formants, cpps_db=0, hnr_db=0
    )


def test_resonance_contrast(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["resonance-contrast"]
    ref = "exercise:resonance-contrast@1"
    # the ordinary sound, a darker one, a brighter one, on one note
    good = [segment(0, 1000, 180), segment(3, 930, 181), segment(6, 1080, 182)]
    result = evaluate(ref, exercise, facts(None, segments=good))
    assert result.met is True and result.advice == []
    assert [m.key for m in result.measures] == [
        "step_bright_pct",
        "step_drift_st",
        "step_r1_pct",
        "step_dark_pct",
    ]
    got = measures(result)
    assert got["step_bright_pct"] == pytest.approx(8.0)
    assert got["step_r1_pct"] == pytest.approx(8.0)
    assert got["step_dark_pct"] == pytest.approx(-7.0)
    assert got["step_drift_st"] < 0.2
    # the pitch going with the colour: the numbers are still shown, the rep is not met
    drifting = [segment(0, 1000, 180), segment(3, 930, 130), segment(6, 1080, 234)]
    drift = evaluate(ref, exercise, facts(None, segments=drifting))
    assert (drift.met, drift.advice) == (False, ["pitch-moved"])
    assert measures(drift)["step_drift_st"] > 10
    assert measures(drift)["step_bright_pct"] == pytest.approx(8.0)
    # a short cough between the sounds is not one of them
    cough = [*good[:2], segment(4.5, 900, 180, seconds=1.5), good[2]]
    assert evaluate(ref, exercise, facts(None, segments=cough)).met
    # a last sound within what two takes of one sound differ by is not brighter
    same = [segment(0, 1000, 180), segment(3, 930, 180), segment(6, 1010, 180)]
    flat = evaluate(ref, exercise, facts(None, segments=same))
    assert (flat.met, flat.advice) == (False, ["not-brighter"])
    # a "bright" sound that shot up in pitch cannot be measured: no numbers, and why
    squeak = good[:2] + [
        VowelSegment(start_s=6, duration_s=2.5, pitch_hz=520, formants_hz=[], cpps_db=0, hnr_db=0)
    ]
    high = evaluate(ref, exercise, facts(None, segments=squeak))
    assert (high.met, high.advice) == (False, ["pitch-moved", "pitch-too-high"])
    assert [m.key for m in high.measures] == ["step_drift_st"]
    # an unmeasured sound in between only costs its own number
    gap = [
        good[0],
        VowelSegment(start_s=3, duration_s=2.5, pitch_hz=181, formants_hz=[], cpps_db=0, hnr_db=0),
        good[2],
    ]
    partly = evaluate(ref, exercise, facts(None, segments=gap))
    assert partly.met is True and "step_dark_pct" not in measures(partly)
    two = evaluate(ref, exercise, facts(None, segments=good[:2]))
    assert two.met is False and measures(two)["steps_found"] == 2
    # a bright sound whose voice went light: brighter, but its first resonance is not read
    light = [good[0], good[1], good[2].model_copy(update={"h1h2_db": 13.6})]
    airy = evaluate(ref, exercise, facts(None, segments=light))
    assert (airy.met, airy.advice) == (True, ["r1-unreadable"])
    assert "step_r1_pct" not in measures(airy)
    assert measures(airy)["step_bright_pct"] == pytest.approx(8.0)
    firm = [s.model_copy(update={"h1h2_db": 9.0, "r1_unreadable_pct": 0.0}) for s in good]
    assert "step_r1_pct" in measures(evaluate(ref, exercise, facts(None, segments=firm)))


def whispered(*positions: tuple[float, float]) -> list[WhisperSpan]:
    """One whispered second per pair: (how much higher F1 sits, how much higher F2 to F4)."""
    big = (700.0, 1700.0, 2400.0, 3800.0)
    return [
        WhisperSpan(
            start_s=float(index),
            duration_s=1.0,
            formants_hz=[big[0] * first, *(f * upper for f in big[1:])],
        )
        for index, (first, upper) in enumerate(positions)
    ]


def test_whisper_slide(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["whisper-slide"]
    ref = "exercise:whisper-slide@1"
    steady = [(1.0, 1.0)] * 3
    # big for three seconds, then small; one second that reads wildly does not decide
    slide = whispered(*steady, (1.1, 1.05), (1.3, 1.15), (1.32, 1.16), (1.28, 1.14), (2.0, 1.6))
    result = evaluate(ref, exercise, facts(None, whisper=slide))
    assert result.met is True and result.advice == []
    assert [m.key for m in result.measures] == ["whisper_r1_pct", "whisper_bright_pct"]
    got = measures(result)
    assert got["whisper_r1_pct"] == pytest.approx(32.0)
    assert got["whisper_bright_pct"] == pytest.approx(16.0)
    assert [m.low for m in result.measures] == [8.0, 5.0]
    # a whisper that stays where it started
    flat = whispered(*steady, (1.02, 1.0), (0.98, 1.01), (1.03, 1.02))
    same = evaluate(ref, exercise, facts(None, whisper=flat))
    assert (same.met, same.advice) == (False, ["whisper-same"])
    # the vowel sliding to "ee": the upper resonances rise, the first one falls
    vowel_slide = whispered(*steady, (0.8, 1.2), (0.78, 1.22), (0.8, 1.21))
    ee = evaluate(ref, exercise, facts(None, whisper=vowel_slide))
    assert ee.met is False and measures(ee)["whisper_r1_pct"] < 0
    # too little whisper to tell a start from a slide; a voiced take has none at all
    short = evaluate(ref, exercise, facts(None, whisper=slide[:5]))
    assert (short.met, short.problem) == (None, EvaluationProblem.TOO_LITTLE_WHISPER)
    assert evaluate(ref, exercise, facts(None)).problem == EvaluationProblem.TOO_LITTLE_WHISPER
    # comfort is a gate here as everywhere
    strained = facts(None, whisper=slide)
    strained.comfort = 1
    assert evaluate(ref, exercise, strained).strained is True


def test_problems(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["count-in-band"]
    waiting = evaluate("exercise:count-in-band@1", exercise, TakeFacts(analysed=False))
    assert waiting.problem == EvaluationProblem.NOT_ANALYSED and waiting.met is None
    no_band = evaluate("exercise:count-in-band@1", exercise, facts(contour((190, 190, 1)), None))
    assert no_band.problem == EvaluationProblem.NO_BAND
    silent = evaluate("exercise:count-in-band@1", exercise, facts(contour((0, 0, 2))))
    assert silent.problem == EvaluationProblem.TOO_LITTLE_VOICE
    gone = evaluate("exercise:retired@3", None, facts(contour((190, 190, 1))))
    assert gone.problem == EvaluationProblem.UNKNOWN_EXERCISE
    plain = evaluate("exercise:hum-glide@1", catalogue["hum-glide"], facts(None))
    assert plain.met is None and plain.problem is None and plain.measures == []


def test_every_measure_has_texts() -> None:
    from puptrainer.core.content import load_measures

    for measure in load_measures(CONTENT):
        assert set(measure.titles) == set(measure.descriptions) == {"en", "cs"}, measure.key


def test_a_strained_rep_is_never_met(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["count-in-band"]
    take = facts(contour((190, 190, 2.0)))
    assert evaluate("exercise:count-in-band@1", exercise, take).met is True
    take.comfort = 1
    strained = evaluate("exercise:count-in-band@1", exercise, take)
    assert (strained.met, strained.strained) == (False, True)
    assert strained.measures[0].met is True  # the numbers themselves were fine
    take.comfort = 2
    assert evaluate("exercise:count-in-band@1", exercise, take).met is True


def test_advice_says_where_the_pitch_sat(catalogue: dict[str, Exercise]) -> None:
    count = catalogue["count-in-band"]
    high = evaluate("exercise:count-in-band@2", count, facts(contour((240, 240, 2.0))))
    assert (high.met, high.advice) == (False, ["above-band"])
    low = evaluate("exercise:count-in-band@2", count, facts(contour((150, 150, 2.0))))
    assert low.advice == ["below-band"]
    assert evaluate("exercise:count-in-band@2", count, facts(contour((190, 190, 2.0)))).advice == []

    slide = catalogue["slide-down-hold"]
    above = evaluate("exercise:slide-down-hold@2", slide, facts(contour((320, 260, 3.0))))
    assert above.advice == ["above-band"]
    wobbly = contour(*[(180, 215, 0.4), (215, 180, 0.4)] * 4)
    assert evaluate("exercise:slide-down-hold@2", slide, facts(wobbly)).advice == ["unsteady"]


def test_a_sound_meant_to_be_high_may_sit_above_the_band(catalogue: dict[str, Exercise]) -> None:
    awww = catalogue["awww-phrase"]
    high = evaluate("exercise:awww-phrase@2", awww, facts(contour((250, 250, 2.0))))
    assert high.met is True
    assert measures(high)["band_up_share_pct"] == 100
    low = evaluate("exercise:awww-phrase@2", awww, facts(contour((150, 150, 2.0))))
    assert (low.met, low.advice) == (False, ["below-band"])


def test_a_missed_note_says_how_far_and_which_way(catalogue: dict[str, Exercise]) -> None:
    exercise = catalogue["note-match"]
    note = Target(band_low_hz=170.0, band_high_hz=220.0, note_hz=196.0)
    under = evaluate("exercise:note-match@2", exercise, facts(contour((131, 131, 3.0)), note))
    assert (under.met, under.advice) == (False, ["below-note"])
    assert measures(under)["note_offset_st"] == pytest.approx(-6.97, abs=0.05)
    over = evaluate("exercise:note-match@2", exercise, facts(contour((230, 230, 3.0)), note))
    assert over.advice == ["above-note"]
    brief = contour((131, 196, 1.0), (196, 196, 0.8))
    assert evaluate("exercise:note-match@2", exercise, facts(brief, note)).advice == ["unsteady"]


def test_an_effortful_rep_counts_with_the_advice_to_go_easier(
    catalogue: dict[str, Exercise],
) -> None:
    take = facts(contour((190, 190, 2.0)))
    take.comfort = 2
    result = evaluate("exercise:count-in-band@2", catalogue["count-in-band"], take)
    assert (result.met, result.advice) == (True, ["effortful"])


def test_a_spoken_exercise_is_left_to_its_reading(catalogue: dict[str, Exercise]) -> None:
    phrase = facts(None, metrics={"vtl_cm": 16.9, "pitch_median_hz": 420.0})
    result = evaluate("exercise:bright-phrase@2", catalogue["bright-phrase"], phrase)
    assert (result.met, result.measures, result.hints, result.advice) == (None, [], [], [])
