from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from puptrainer.analysis.worker import run_once
from puptrainer.core.reading import (
    REFERENCE_TAKES,
    TYPICAL_PCT,
    Voice,
    comparable,
    everyday_size_cm,
    read,
    reference,
)
from puptrainer.core.schemas import Basis, Item, VowelSegment

from .conftest import upload, vowel, wav_bytes

GARDEN = "passage:garden-en@1"
START = datetime(2026, 11, 16, 19, 0, tzinfo=UTC)
FORMANTS = (400.0, 1400.0, 2450.0, 3500.0)


def voice(
    name: str,
    day: int = 0,
    *,
    item: Item = Item.PASSAGE,
    language: str | None = "en",
    ref: str | None = GARDEN,
    pitch: float = 160.0,
    bright: float = 1.0,
    first: float = 1.0,
    level: float = -23.0,
    clarity: float = 12.0,
) -> Voice:
    """A take of speech whose upper formants are scaled by `bright` and F1 by `first`."""
    f1, *upper = FORMANTS
    metrics = {
        "pitch_median_hz": pitch,
        "f1_median_hz": f1 * first,
        **{f"f{i}_median_hz": f * bright for i, f in enumerate(upper, start=2)},
        "speech_level_dbfs": level,
        "cpps_db": clarity,
    }
    return Voice(name, item, language, ref, START + timedelta(days=day), metrics)


def held(name: str, day: int = 0, scale: float = 1.0) -> Voice:
    shapes = {"a": (700, 1200, 2300, 3500), "i": (260, 2200, 3100, 3700)}
    vowels = [
        VowelSegment(
            start_s=3.0 * index,
            duration_s=2.5,
            vowel=label,
            pitch_hz=180.0,
            formants_hz=[f * scale for f in formants],
            cpps_db=14.0,
            hnr_db=22.0,
        )
        for index, (label, formants) in enumerate(shapes.items())
    ]
    metrics = {"pitch_median_hz": 180.0}
    return Voice(name, Item.VOWELS, None, None, START + timedelta(days=day), metrics, vowels)


EVERYDAY = [
    voice("p1", 0, bright=1.01),
    voice("p2", 1, bright=0.99),
    voice("p3", 3, bright=1.0),
    voice("f1", 0, item=Item.FREE, ref=None, bright=0.96),
    voice("f2", 1, item=Item.FREE, ref=None, bright=0.97),
    voice("c1", 0, language="cs", ref="passage:garden-cs@1", bright=1.03),
    held("v1", 0),
    voice("g1", 0, item=Item.GLIDE, language=None, ref=None),
]


def test_a_take_is_read_against_the_most_alike_everyday_takes() -> None:
    def chosen(item: Item, language: str | None, ref: str | None) -> tuple[Basis, list[str]]:
        found = comparable(item, language, ref, EVERYDAY)
        assert found is not None
        return found[0], [v.id for v in found[1]]

    assert chosen(Item.PASSAGE, "en", GARDEN) == (Basis.SAME_TEXT, ["p1", "p2", "p3"])
    assert chosen(Item.FREE, "en", None) == (Basis.SAME_KIND, ["f1", "f2"])
    # a text never read in the everyday voice: everyday speech in its language
    assert chosen(Item.PHRASE, "en", "passage:anchors-en@1") == (
        Basis.SPEECH,
        ["p1", "f1", "p2", "f2", "p3"],
    )
    # a language without everyday takes: everyday speech at all, the earliest five
    assert chosen(Item.FREE, "de", None)[1] == ["p1", "f1", "c1", "p2", "f2"]
    assert chosen(Item.SUSTAIN, None, None) == (Basis.VOWELS, ["v1"])
    assert comparable(Item.GLIDE, None, None, EVERYDAY) is None
    assert comparable(Item.PASSAGE, "en", GARDEN, []) is None
    many = [voice(f"p{day}", day) for day in range(9)]
    found = comparable(Item.PASSAGE, "en", GARDEN, list(reversed(many)))
    assert found is not None and [v.id for v in found[1]] == ["p0", "p1", "p2", "p3", "p4"]
    assert len(found[1]) == REFERENCE_TAKES


def test_reading_of_an_attempt() -> None:
    attempt = voice("try", 4, pitch=160.0 * 2 ** (4 / 12), bright=1.07, first=0.8, level=-27.0)
    reading = read(attempt, EVERYDAY)
    assert reading is not None and (reading.basis, reading.takes) == (Basis.SAME_TEXT, 3)
    shifts = {s.key: s for s in reading.shifts}
    assert list(shifts) == [
        "pitch_shift_st",
        "brightness_pct",
        "r1_shift_pct",
        "level_shift_db",
        "clarity_shift_db",
    ]
    assert shifts["pitch_shift_st"].value == pytest.approx(4.0)
    assert shifts["pitch_shift_st"].everyday == pytest.approx(160.0)
    assert shifts["brightness_pct"].value == pytest.approx(7.0, abs=0.05)
    assert shifts["brightness_pct"].everyday is None
    # the everyday takes scatter by a percent themselves
    assert shifts["brightness_pct"].wobble == pytest.approx(1.0, abs=0.05)
    assert shifts["r1_shift_pct"].value == pytest.approx(-20.0)
    assert shifts["r1_shift_pct"].everyday == pytest.approx(400.0)
    assert shifts["level_shift_db"].value == pytest.approx(-4.0)
    assert shifts["clarity_shift_db"].value == pytest.approx(0.0)
    assert reading.notes == ["brighter", "r1-fell", "quieter"]


@pytest.mark.parametrize(
    ("bright", "note"),
    [
        (0.94, "darker"),
        (1.015, "everyday"),
        (1.05, "brighter"),
        (1.0 + (TYPICAL_PCT[0] + 1) / 100, "typical"),
        (1.0 + (TYPICAL_PCT[1] + 1) / 100, "beyond"),
    ],
)
def test_where_the_resonance_sits(bright: float, note: str) -> None:
    reading = read(voice("try", 9, bright=bright, clarity=9.0), EVERYDAY)
    assert reading is not None and reading.notes == [note, "less-clear"]


def test_an_everyday_take_reads_as_itself_and_few_takes_have_no_wobble() -> None:
    reading = read(EVERYDAY[0], EVERYDAY)
    assert reading is not None and reading.notes == ["everyday"]
    free = read(voice("try", 5, item=Item.FREE, ref=None, bright=1.1), EVERYDAY)
    assert free is not None and free.basis == Basis.SAME_KIND
    assert all(shift.wobble is None for shift in free.shifts)
    # under the noise floor nothing is called a change, however alike two takes are
    assert free.shifts[1].value == pytest.approx(100 * (1.1 / (0.96 * 0.97) ** 0.5 - 1))


def test_held_vowels_are_read_vowel_by_vowel() -> None:
    reading = read(held("try", 5, scale=1.1), EVERYDAY)
    assert reading is not None and reading.basis == Basis.VOWELS
    shifts = {s.key: s.value for s in reading.shifts}
    assert shifts == pytest.approx(
        {"pitch_shift_st": 0.0, "brightness_pct": 10.0, "r1_shift_pct": 10.0}
    )
    everyday_i = reference(Basis.VOWELS, [EVERYDAY[6]]).vowels["i"]
    assert everyday_i == pytest.approx([260, 2200, 3100, 3700])


def test_other_words_are_read_on_pitch_only() -> None:
    phrase = voice("try", 5, item=Item.PHRASE, ref="passage:anchors-en@1", pitch=200.0, bright=0.84)
    reading = read(phrase, EVERYDAY)
    assert reading is not None and (reading.basis, reading.takes) == (Basis.SPEECH, 5)
    assert [s.key for s in reading.shifts] == [
        "pitch_shift_st",
        "level_shift_db",
        "clarity_shift_db",
    ]
    assert reading.notes == []
    # once the same words exist in the everyday voice, they are what counts
    same = voice("a1", 2, item=Item.PHRASE, ref="passage:anchors-en@1", bright=0.84)
    again = read(phrase, [*EVERYDAY, same])
    assert again is not None and again.basis == Basis.SAME_TEXT
    assert {s.key: s.value for s in again.shifts}["brightness_pct"] == pytest.approx(0.0)


def test_what_is_not_read() -> None:
    glide = voice("g", 5, item=Item.GLIDE, language=None, ref=None)
    drill = voice("s", 5, item=Item.SUSTAIN, language=None, ref=None)
    assert read(glide, EVERYDAY) is None and read(drill, EVERYDAY) is None
    assert read(voice("try", 5), []) is None
    unmeasured = Voice("u", Item.PASSAGE, "en", GARDEN, START, {"duration_s": 3.0})
    assert read(unmeasured, EVERYDAY) is None


def test_everyday_size() -> None:
    # a uniform tube of 17.5 cm resonates at 500, 1500, 2500, 3500 Hz
    tube = Voice(
        "t",
        Item.FREE,
        "en",
        None,
        START,
        {f"f{i}_median_hz": 1000.0 * (2 * i - 1) / 2 for i in range(1, 5)},
    )
    assert everyday_size_cm(Item.PHRASE, "en", None, [tube]) == pytest.approx(17.5)
    assert everyday_size_cm(Item.SUSTAIN, None, None, [tube]) is None
    assert everyday_size_cm(Item.SUSTAIN, None, None, EVERYDAY) == pytest.approx(18.4, abs=0.5)


def test_takes_are_served_with_their_reading(client: TestClient, device_id: int) -> None:
    everyday = wav_bytes(vowel((500.0, 1500.0, 2500.0, 3500.0, 4500.0), seconds=3.0))
    brighter = wav_bytes(vowel((570.0, 1710.0, 2850.0, 3990.0, 5130.0), seconds=3.0))
    query = {"device_id": device_id, "item": "free", "language": "en"}
    assert client.get("/api/v1/reference", params=query).json() is None
    first = upload(client, device_id, everyday, item="free").json()
    assert first["reading"] is None  # not analysed yet
    attempt = upload(client, device_id, brighter, item="free", intent="attempt").json()
    drill = upload(client, device_id, brighter, item="sustain", intent="drill").json()
    while run_once(client):
        pass

    reading = client.get(f"/api/v1/takes/{attempt['id']}").json()["reading"]
    assert (reading["basis"], reading["takes"]) == ("same-kind", 1)
    shifts = {s["key"]: s for s in reading["shifts"]}
    assert shifts["brightness_pct"]["value"] == pytest.approx(14.0, abs=3.0)
    assert shifts["brightness_pct"]["wobble"] is None
    assert shifts["pitch_shift_st"]["value"] == pytest.approx(0.0, abs=0.3)
    assert "typical" in reading["notes"] or "brighter" in reading["notes"]
    listed = {t["id"]: t for t in client.get("/api/v1/takes").json()}
    assert listed[attempt["id"]]["reading"] == reading
    assert listed[first["id"]]["reading"]["notes"] == ["everyday"]
    assert listed[drill["id"]]["reading"] is None

    voice_now = client.get("/api/v1/reference", params=query).json()
    assert (voice_now["basis"], voice_now["take_ids"]) == ("same-kind", [first["id"]])
    assert voice_now["formants_hz"] == pytest.approx([500, 1500, 2500, 3500], rel=0.06)
    assert voice_now["vowels"] == {}
    # another microphone setup has no everyday voice of its own
    other = client.post("/api/v1/devices", json={"name": "phone", "kind": "phone"}).json()["id"]
    assert client.get("/api/v1/reference", params={**query, "device_id": other}).json() is None
    elsewhere = upload(client, other, brighter, item="free", intent="attempt").json()
    run_once(client)
    assert client.get(f"/api/v1/takes/{elsewhere['id']}").json()["reading"] is None
    assert client.get("/api/v1/reference", params={"item": "free"}).status_code == 422
