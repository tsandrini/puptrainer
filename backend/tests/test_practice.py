import json

import pytest
from fastapi.testclient import TestClient

from puptrainer.analysis.worker import run_once

from .conftest import tone, upload, wav_bytes

SESSION = "0b6d2f4e-6a51-4c3e-9b39-6f0c2e9a1d11"
STARTED = "2026-11-18T08:00:00Z"


def practice(client: TestClient, session: str = SESSION, **body: object):
    return client.put(f"/api/v1/practice/{session}", json={"started_at": STARTED, **body})


def test_bands_are_a_history(client: TestClient) -> None:
    assert client.get("/api/v1/bands").json() == []
    assert client.post("/api/v1/bands", json={"low_hz": 200, "high_hz": 190}).status_code == 422
    assert client.post("/api/v1/bands", json={"low_hz": 200, "high_hz": 205}).status_code == 422
    first = client.post("/api/v1/bands", json={"low_hz": 165, "high_hz": 200})
    assert first.status_code == 201
    client.post("/api/v1/bands", json={"low_hz": 175, "high_hz": 220})
    bands = client.get("/api/v1/bands").json()
    assert [(b["low_hz"], b["high_hz"]) for b in bands] == [(175, 220), (165, 200)]


def test_practice_session_is_written_idempotently(client: TestClient) -> None:
    created = practice(client, routine_ref="routine:pitch@1", language="en", feel_start="fresh")
    assert created.status_code == 200, created.text
    again = practice(client, routine_ref="routine:pitch@1", language="en", feel_start="fresh")
    assert again.json() == created.json()
    ended = practice(
        client,
        routine_ref="routine:pitch@1",
        language="en",
        ended_at="2026-11-18T08:07:00Z",
        comfort_end=4,
        lasting_tension=False,
    )
    body = ended.json()
    assert (body["comfort_end"], body["lasting_tension"], body["take_count"]) == (4, False, 0)
    assert body["feel_start"] is None  # a write replaces the whole session
    assert [p["id"] for p in client.get("/api/v1/practice").json()] == [SESSION]
    assert client.get(f"/api/v1/practice/{SESSION}").json() == body


@pytest.mark.parametrize(
    ("session", "body", "status"),
    [
        (SESSION, {"routine_ref": "routine:pitch@9"}, 422),
        (SESSION, {"routine_ref": "routine:marathon@1"}, 422),
        (SESSION, {"routine_ref": "pitch"}, 422),
        (SESSION, {"comfort_end": 6}, 422),
        (SESSION, {"feel_start": "grumpy"}, 422),
        ("short", {}, 422),
        ("bad id with spaces!", {}, 422),
    ],
)
def test_practice_session_rejections(
    client: TestClient, session: str, body: dict[str, object], status: int
) -> None:
    assert practice(client, session, **body).status_code == status


def test_practice_takes_are_labelled_and_judged(client: TestClient, device_id: int) -> None:
    labels = {
        "item": "sustain",
        "intent": "drill",
        "exercise_ref": "exercise:slide-down-hold@1",
        "target": {"band_low_hz": 170, "band_high_hz": 220, "note_hz": None},
        "comfort": 4,
    }
    held = wav_bytes(tone(f0=190.0, seconds=3.0))
    # the session is written before its takes; a take of an unknown one is refused
    assert upload(client, device_id, held, session_id=SESSION, **labels).status_code == 422
    practice(client, routine_ref="routine:resonance@1")
    take = upload(
        client, device_id, held, session_id=SESSION, client_id="rep-0000-0001", **labels
    ).json()
    assert (take["session_id"], take["comfort"]) == (SESSION, 4)
    assert take["client_id"] == "rep-0000-0001"
    assert take["target"] == {"band_low_hz": 170, "band_high_hz": 220, "note_hz": None}
    assert take["evaluation"]["problem"] == "not-analysed"

    assert run_once(client) is True
    judged = client.get(f"/api/v1/takes/{take['id']}").json()["evaluation"]
    assert judged["met"] is True
    assert judged["rule"] == "pitch_hold"
    hold = {m["key"]: m for m in judged["measures"]}
    assert hold["hold_s"]["value"] == pytest.approx(3.0, abs=0.1)
    assert hold["hold_pitch_hz"]["value"] == pytest.approx(190.0, abs=1.0)
    assert judged["hints"] == []

    summary = client.get(f"/api/v1/practice/{SESSION}").json()
    assert summary["take_count"] == 1
    listed = client.get("/api/v1/takes", params={"session_id": SESSION}).json()
    assert [t["id"] for t in listed] == [take["id"]]
    patched = client.patch(f"/api/v1/takes/{take['id']}", json={"comfort": 2}).json()
    assert patched["comfort"] == 2
    assert client.patch(f"/api/v1/takes/{take['id']}", json={"comfort": 0}).status_code == 422


def test_lab_takes_have_no_evaluation(client: TestClient, device_id: int) -> None:
    take = upload(client, device_id).json()
    assert take["evaluation"] is None
    assert (take["session_id"], take["exercise_ref"], take["comfort"]) == (None, None, None)


@pytest.mark.parametrize(
    ("ref", "status"),
    [
        ("exercise:note-match@1", 201),
        ("exercise:note-match@2", 201),
        ("exercise:note-match@3", 422),
        ("exercise:yodel@1", 422),
        ("note-match", 422),
    ],
)
def test_exercise_reference_is_checked(
    client: TestClient, device_id: int, ref: str, status: int
) -> None:
    response = upload(client, device_id, item="sustain", intent="drill", exercise_ref=ref)
    assert response.status_code == status, response.text


def test_target_band_must_be_ordered(client: TestClient, device_id: int) -> None:
    target = {"band_low_hz": 220, "band_high_hz": 170, "note_hz": None}
    assert upload(client, device_id, target=target).status_code == 422


def test_deleting_a_session_keeps_its_takes(client: TestClient, device_id: int) -> None:
    practice(client)
    take = upload(client, device_id, session_id=SESSION).json()
    assert client.delete(f"/api/v1/practice/{SESSION}").status_code == 204
    assert client.get(f"/api/v1/practice/{SESSION}").status_code == 404
    assert client.get(f"/api/v1/takes/{take['id']}").json()["session_id"] is None
    assert client.delete(f"/api/v1/practice/{SESSION}").status_code == 404


def test_measures_have_texts(client: TestClient) -> None:
    measures = client.get("/api/v1/measures").json()
    assert {m["key"] for m in measures} >= {"band_share_pct", "hold_s", "step_rise_pct"}
    assert all(m["titles"].keys() == {"en", "cs"} for m in measures)


def test_content_has_the_catalogue(client: TestClient) -> None:
    content = client.get("/api/v1/content").json()
    assert {r["id"] for r in content["routines"]} == {"pitch", "resonance"}
    note = next(e for e in content["exercises"] if e["id"] == "note-match")
    assert note["rule"] == {
        "kind": "pitch_hold",
        "at": "note",
        "min_hold_s": 1.5,
        "tolerance_cents": 50.0,
        "spread_cents": 50.0,
    }
    assert json.dumps(content)  # serialisable as it is


def test_setting_the_same_band_again_adds_nothing(client: TestClient) -> None:
    first = client.post("/api/v1/bands", json={"low_hz": 165, "high_hz": 205}).json()
    again = client.post("/api/v1/bands", json={"low_hz": 165, "high_hz": 205}).json()
    assert again == first
    assert len(client.get("/api/v1/bands").json()) == 1
    client.post("/api/v1/bands", json={"low_hz": 170, "high_hz": 205})
    assert len(client.get("/api/v1/bands").json()) == 2


def test_practice_sizes_are_read_against_the_lab_baseline(
    client: TestClient, device_id: int
) -> None:
    from .conftest import vowel

    speech = wav_bytes(vowel((500.0, 1500.0, 2500.0, 3500.0, 4500.0), seconds=3.0))
    upload(client, device_id, speech, item="free")  # the everyday voice, 17.5 cm
    labels = {
        "item": "phrase",
        "intent": "attempt",
        "exercise_ref": "exercise:bright-phrase@1",
        "target": {"band_low_hz": 110, "band_high_hz": 130, "note_hz": None},
    }
    brighter = wav_bytes(vowel((570.0, 1710.0, 2850.0, 3990.0, 5130.0), seconds=3.0))
    take = upload(client, device_id, brighter, **labels).json()
    while run_once(client):
        pass
    judged = client.get(f"/api/v1/takes/{take['id']}").json()["evaluation"]
    assert judged["met"] is None
    size = judged["hints"][0]
    assert size["key"] == "vtl_cm"
    assert size["value"] == pytest.approx(15.35, abs=0.5)
    assert size["baseline"] == pytest.approx(17.5, abs=0.5)
    # a practice take is not part of the baseline, and another setup has none
    listed = client.get("/api/v1/takes", params={"item": "phrase"}).json()
    assert listed[0]["evaluation"]["hints"][0]["baseline"] == size["baseline"]
    other = client.post("/api/v1/devices", json={"name": "phone", "kind": "phone"}).json()["id"]
    elsewhere = upload(client, other, brighter, **labels).json()
    run_once(client)
    hint = client.get(f"/api/v1/takes/{elsewhere['id']}").json()["evaluation"]["hints"][0]
    assert hint["baseline"] is None
