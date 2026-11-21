import numpy as np
import pytest

from puptrainer.core.schemas import Details, Item, Series, VowelSegment, WhisperSpan
from puptrainer.core.trace import trace

ORDINARY = (650.0, 1200.0, 2400.0, 3500.0)


def series(values: list[float | None], step: float = 0.02) -> Series:
    return Series(start_s=0.0, step_s=step, values=values)


def spread(parts: list[tuple[float | None, float]], step: float = 0.02) -> list[float | None]:
    """Pieces of (value, seconds) laid end to end."""
    out: list[float | None] = []
    for value, seconds in parts:
        out += [value] * round(seconds / step)
    return out


def rows(found) -> dict[str, list[float | None]]:  # noqa: ANN001
    return {row.key: row.values for row in found.rows}


def held(start: float, formants: tuple[float, ...] = ORDINARY) -> VowelSegment:
    return VowelSegment(
        start_s=start, duration_s=2.0, pitch_hz=180.0, formants_hz=list(formants),
        cpps_db=14.0, hnr_db=22.0,
    )  # fmt: skip


def test_speech_is_traced_on_pitch_source_and_level() -> None:
    stored = {
        "pitch_hz": series(spread([(None, 0.5), (170.0, 1.0), (None, 0.5)], 0.01), 0.01),
        "level_db": series(spread([(-70.0, 0.5), (-20.0, 1.0), (-70.0, 0.5)])),
        "h1h2_db": series(spread([(None, 0.5), (6.0, 1.0), (None, 0.5)])),
        "cpp_db": series(spread([(None, 0.5), (22.0, 1.0), (None, 0.5)])),
        "f1_hz": series(spread([(None, 0.5), (400.0, 1.0), (None, 0.5)])),
    }
    found = trace(Item.PASSAGE, stored, Details())
    assert (found.start_s, found.step_s) == (pytest.approx(0.05), pytest.approx(0.1))
    got = rows(found)
    # formants follow the words: speech gets no resonance rows
    assert list(got) == ["pitch_hz", "lightness_db", "clarity_db", "level_db"]
    assert all(len(values) == 20 for values in got.values())
    assert got["pitch_hz"][2] is None and got["pitch_hz"][10] == 170.0
    # where the voice starts and stops, the source is not read: half a step is not voice
    assert got["pitch_hz"][5] == 170.0 and got["lightness_db"][5] is None
    assert got["pitch_hz"][14] == 170.0 and got["clarity_db"][14] is None
    assert got["lightness_db"][10] == 6.0 and got["clarity_db"][10] == 22.0
    assert got["level_db"][2] == -70.0 and got["level_db"][10] == -20.0
    assert (found.zero, found.spans) == (None, [])
    assert found.r1_unreadable == [False] * 20


def test_held_sounds_are_counted_from_the_first() -> None:
    bright = tuple(f * 1.1 for f in ORDINARY)
    parts = [(1.0, 2.0), (None, 1.0), (1.1, 1.0), (1.1, 1.0)]
    stored = {
        "pitch_hz": series(spread([(180.0, 2.0), (None, 1.0), (230.0, 2.0)], 0.01), 0.01),
        # the last second of the bright sound is light: the fundamental leads by 15 dB
        "h1h2_db": series(spread([(8.0, 2.0), (None, 1.0), (8.0, 1.0), (15.0, 1.0)])),
        "level_db": series(spread([(-20.0, 5.0)])),
    }
    for index, formant in enumerate(ORDINARY, start=1):
        values = spread([(None if scale is None else formant * scale, s) for scale, s in parts])
        stored[f"f{index}_hz"] = series(values)
    details = Details(segments=[held(0.0), held(3.0, bright)])
    found = trace(Item.SUSTAIN, stored, details)
    got = rows(found)
    assert list(got) == ["pitch_hz", "brightness_pct", "r1_pct", "lightness_db", "level_db"]
    assert found.zero == "first-sound"
    assert [(s.start_s, s.end_s, s.kind) for s in found.spans] == [
        (0.0, 2.0, "held"),
        (3.0, 5.0, "held"),
    ]
    assert got["brightness_pct"][5] == pytest.approx(0.0)
    assert got["brightness_pct"][25] is None
    assert got["brightness_pct"][35] == pytest.approx(10.0)
    assert got["r1_pct"][35] == pytest.approx(10.0)
    # where the voice is light the first resonance is not read; the brightness still is
    assert got["r1_pct"][45] is None and got["brightness_pct"][45] == pytest.approx(10.0)
    assert found.r1_unreadable[45] is True and found.r1_unreadable[35] is False
    assert sum(found.r1_unreadable) == pytest.approx(10, abs=3)


def test_a_first_resonance_at_the_pitch_is_not_read() -> None:
    stored = {
        "pitch_hz": series(spread([(240.0, 2.0)], 0.01), 0.01),
        "h1h2_db": series(spread([(6.0, 2.0)])),
        "f1_hz": series(spread([(650.0, 1.0), (280.0, 1.0)])),
        "f2_hz": series(spread([(1200.0, 2.0)])),
        "f3_hz": series(spread([(2400.0, 2.0)])),
        "f4_hz": series(spread([(3500.0, 2.0)])),
    }
    found = trace(Item.SUSTAIN, stored, Details(segments=[held(0.0)]))
    assert rows(found)["r1_pct"][5] == pytest.approx(0.0)
    assert rows(found)["r1_pct"][15] is None and found.r1_unreadable[15] is True


def test_a_whisper_is_counted_from_its_first_seconds() -> None:
    small = tuple(f * 1.2 for f in ORDINARY)
    spans = [
        WhisperSpan(
            start_s=float(s), duration_s=1.0, formants_hz=list(ORDINARY if s < 3 else small)
        )
        for s in (0, 1, 2, 4, 5, 6)
    ]
    stored = {"level_db": series(spread([(-35.0, 7.0)]))}
    for index, formant in enumerate(ORDINARY, start=1):
        # puffs: a quarter of each second sounds, the rest is breath being drawn
        puffs = [
            (formant * scale, 0.26) if scale else (None, 1.0)
            for scale in (1, 1, 1, 0, 1.2, 1.2, 1.2)
        ]
        values = spread(
            [part for puff in puffs for part in ([puff, (None, 0.74)] if puff[0] else [puff])]
        )
        stored[f"f{index}_hz"] = series(values)
    found = trace(Item.SUSTAIN, stored, Details(whisper=spans))
    got = rows(found)
    assert list(got) == ["brightness_pct", "r1_pct", "level_db"]
    assert found.zero == "first-whisper"
    # the whispered seconds run together where they touch
    assert [(s.start_s, s.end_s, s.kind) for s in found.spans] == [
        (0.0, 3.0, "whisper"),
        (4.0, 7.0, "whisper"),
    ]
    assert got["r1_pct"][10] == pytest.approx(0.0) and got["r1_pct"][50] == pytest.approx(20.0)
    assert got["brightness_pct"][50] == pytest.approx(20.0)
    # a whispered second is one value from end to end, between its puffs too
    assert got["r1_pct"][15:20] == pytest.approx([0.0] * 5)
    assert got["brightness_pct"][40:70] == pytest.approx([20.0] * 30)
    assert got["brightness_pct"][35] is None
    # no pitch, so nothing stands in the way of reading the first resonance
    assert not any(found.r1_unreadable)


def test_an_older_analysis_yields_its_pitch_only() -> None:
    stored = {"pitch_hz": series(spread([(170.0, 1.0)], 0.01), 0.01)}
    found = trace(Item.SUSTAIN, stored, Details(segments=[held(0.0)]))
    assert list(rows(found)) == ["pitch_hz"] and found.zero is None
    assert len(found.r1_unreadable) == 10
    empty = trace(Item.PASSAGE, {}, Details())
    assert (empty.rows, empty.r1_unreadable, empty.spans) == ([], [], [])


def test_a_step_needs_enough_frames() -> None:
    values: list[float | None] = [None] * 100
    values[10], values[20], values[21], values[22] = 170.0, 180.0, 180.0, 181.0
    found = trace(Item.PASSAGE, {"pitch_hz": series(values, 0.01)}, Details())
    pitch = rows(found)["pitch_hz"]
    assert pitch[1] is None and pitch[2] == 180.0
    assert np.sum([v is not None for v in pitch]) == 1
