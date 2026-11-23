from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from puptrainer.analysis.worker import run_once
from puptrainer.core.settings import Settings

from .conftest import tone, upload, vowel, wav_bytes

ANCHORS = {"item": "phrase", "content_ref": "passage:anchors-en@1"}
DARK = (500.0, 1500.0, 2500.0, 3500.0, 4500.0)
BRIGHT = (570.0, 1710.0, 2850.0, 3990.0, 5130.0)


def person(client: TestClient, name: str = "A friend") -> int:
    response = client.post("/api/v1/people", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def brightness(client: TestClient, take_id: str) -> tuple[int, float]:
    """How many everyday takes a take is read against, and how much brighter it is."""
    reading = client.get(f"/api/v1/takes/{take_id}").json()["reading"]
    shifts = {shift["key"]: shift["value"] for shift in reading["shifts"]}
    return reading["takes"], shifts["brightness_pct"]


def test_there_is_one_person_at_first_and_takes_are_theirs(
    client: TestClient, device_id: int
) -> None:
    (me,) = client.get("/api/v1/people").json()
    assert (me["name"], me["is_default"], me["take_count"]) == ("Me", True, 0)
    take = upload(client, device_id).json()
    assert take["person_id"] == me["id"]
    assert client.get("/api/v1/people").json()[0]["take_count"] == 1


def test_people_are_added_renamed_and_deleted(client: TestClient) -> None:
    friend = person(client)
    assert client.post("/api/v1/people", json={"name": "A friend"}).status_code == 409
    assert client.post("/api/v1/people", json={"name": ""}).status_code == 422
    renamed = client.put(f"/api/v1/people/{friend}", json={"name": "Friend", "note": "a guest"})
    assert (renamed.json()["name"], renamed.json()["note"]) == ("Friend", "a guest")
    assert client.put(f"/api/v1/people/{friend}", json={"name": "Me"}).status_code == 409
    assert client.put("/api/v1/people/999", json={"name": "x"}).status_code == 404
    people = client.get("/api/v1/people").json()
    assert [(p["name"], p["is_default"]) for p in people] == [("Me", True), ("Friend", False)]
    assert client.delete(f"/api/v1/people/{friend}").status_code == 204
    assert client.delete(f"/api/v1/people/{friend}").status_code == 404
    assert [p["name"] for p in client.get("/api/v1/people").json()] == ["Me"]


def test_the_default_person_stays(client: TestClient) -> None:
    (me,) = client.get("/api/v1/people").json()
    refused = client.delete(f"/api/v1/people/{me['id']}", params={"takes": "true"})
    assert refused.status_code == 409
    assert len(client.get("/api/v1/people").json()) == 1


def test_another_voice_is_read_against_the_default_person_and_never_joins_the_baseline(
    client: TestClient, device_id: int
) -> None:
    friend = person(client)
    mine = upload(client, device_id, wav_bytes(vowel(DARK, seconds=3.0)), **ANCHORS).json()
    # NOTE: the friend's own everyday voice: labelled like a baseline take, and not one
    theirs = upload(
        client, device_id, wav_bytes(vowel(BRIGHT, seconds=3.0)), person_id=friend, **ANCHORS
    ).json()
    assert theirs["person_id"] == friend
    while run_once(client):
        pass

    takes, brighter = brightness(client, theirs["id"])
    assert takes == 1
    assert brighter == pytest.approx(14.0, abs=3.0)
    assert brightness(client, mine["id"]) == (1, pytest.approx(0.0, abs=0.01))
    reference = client.get("/api/v1/reference", params={"device_id": device_id, **ANCHORS}).json()
    assert reference["take_ids"] == [mine["id"]]


def test_the_baseline_follows_the_default_person(client: TestClient, device_id: int) -> None:
    friend = person(client)
    mine = upload(client, device_id, wav_bytes(vowel(DARK, seconds=3.0)), **ANCHORS).json()
    theirs = upload(
        client, device_id, wav_bytes(vowel(BRIGHT, seconds=3.0)), person_id=friend, **ANCHORS
    ).json()
    while run_once(client):
        pass

    people = client.post(f"/api/v1/people/{friend}/default").json()
    assert [(p["id"], p["is_default"]) for p in people][0] == (friend, True)
    assert sum(p["is_default"] for p in people) == 1
    assert brightness(client, theirs["id"]) == (1, pytest.approx(0.0, abs=0.01))
    assert brightness(client, mine["id"])[1] == pytest.approx(-12.3, abs=3.0)
    # a take recorded without saying whose it is belongs to the default person of the moment
    assert upload(client, device_id).json()["person_id"] == friend
    assert client.post("/api/v1/people/999/default").status_code == 404


def test_a_take_is_moved_to_another_person_and_listed_by_person(
    client: TestClient, device_id: int
) -> None:
    friend = person(client)
    (me, _) = client.get("/api/v1/people").json()
    take = upload(client, device_id).json()
    upload(client, device_id, note="mine")
    moved = client.patch(f"/api/v1/takes/{take['id']}", json={"person_id": friend})
    assert moved.json()["person_id"] == friend
    listed = client.get("/api/v1/takes", params={"person_id": friend}).json()
    assert [t["id"] for t in listed] == [take["id"]]
    assert len(client.get("/api/v1/takes", params={"person_id": me["id"]}).json()) == 1
    counts = {p["id"]: p["take_count"] for p in client.get("/api/v1/people").json()}
    assert counts == {me["id"]: 1, friend: 1}
    for wrong in (999, None):
        refused = client.patch(f"/api/v1/takes/{take['id']}", json={"person_id": wrong})
        assert refused.status_code == 422
    assert upload(client, device_id, person_id=999).status_code == 422


def test_deleting_a_person_takes_their_recordings_along(
    client: TestClient, device_id: int, settings: Settings
) -> None:
    def recordings() -> int:
        return sum(1 for path in Path(settings.audio_dir).rglob("*") if path.is_file())

    friend = person(client)
    shared = wav_bytes(tone(f0=150.0))
    upload(client, device_id, shared)
    theirs = [
        upload(client, device_id, shared, person_id=friend).json(),
        upload(client, device_id, wav_bytes(tone(f0=220.0)), person_id=friend).json(),
    ]
    assert recordings() == 2

    refused = client.delete(f"/api/v1/people/{friend}")
    assert refused.status_code == 409
    assert len(client.get("/api/v1/takes").json()) == 3

    assert client.delete(f"/api/v1/people/{friend}", params={"takes": "true"}).status_code == 204
    assert [p["name"] for p in client.get("/api/v1/people").json()] == ["Me"]
    for take in theirs:
        assert client.get(f"/api/v1/takes/{take['id']}").status_code == 404
    # NOTE: the recording both people had a take of is still the default person's
    assert len(client.get("/api/v1/takes").json()) == 1
    assert recordings() == 1
    assert client.get("/api/v1/health").json()["pending_jobs"] == 1
