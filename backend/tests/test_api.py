import hashlib
import io
import os
from pathlib import Path

import numpy as np
import soundfile as sf
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi import FastAPI
from fastapi.testclient import TestClient

from puptrainer.api import tstypes
from puptrainer.api.db import Base
from puptrainer.core.metrics import KEYS
from puptrainer.core.settings import Settings

from .conftest import REPO, tone, upload, wav_bytes


def test_migrations_match_the_models(app: FastAPI) -> None:
    with app.state.engine.connect() as connection:
        context = MigrationContext.configure(connection)
        assert compare_metadata(context, Base.metadata) == []


def test_health(client: TestClient) -> None:
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["pending_jobs"] == 0
    assert body["worker_seen_s"] is None


def test_unknown_endpoint_is_a_json_404(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert "error" in response.json()


def test_devices(client: TestClient) -> None:
    created = client.post("/api/v1/devices", json={"name": "lavalier", "kind": "lavalier"})
    assert created.status_code == 201
    assert client.post("/api/v1/devices", json={"name": "lavalier"}).status_code == 409
    assert client.post("/api/v1/devices", json={"name": ""}).status_code == 422
    assert client.post("/api/v1/devices", json={"name": "x", "kind": "kazoo"}).status_code == 422
    device_id = created.json()["id"]
    updated = client.put(
        f"/api/v1/devices/{device_id}", json={"name": "lav", "kind": "lavalier", "note": "collar"}
    )
    assert updated.json()["note"] == "collar"
    assert client.put("/api/v1/devices/999", json={"name": "x"}).status_code == 404
    assert [d["name"] for d in client.get("/api/v1/devices").json()] == ["lav"]


def test_take_upload_read_and_audio(client: TestClient, device_id: int) -> None:
    samples = tone()
    response = upload(
        client,
        device_id,
        wav_bytes(samples),
        content_ref="passage:garden-en@1",
        recorded_at="2026-11-16T19:01:00+01:00",
        note="first",
    )
    assert response.status_code == 201, response.text
    take = response.json()
    assert take["device_name"] == "lavalier"
    assert take["recorded_at"] == "2026-11-16T18:01:00Z"
    assert take["sample_rate"] == 48000
    assert take["duration_s"] == 2.0
    assert take["original_name"] == "take.wav"
    assert take["analysis"]["status"] == "pending"
    assert take["metrics"] == {}
    assert client.get(f"/api/v1/takes/{take['id']}").json() == take
    assert client.get("/api/v1/health").json()["pending_jobs"] == 1

    audio = client.get(f"/api/v1/takes/{take['id']}/audio")
    assert audio.headers["content-type"] == "audio/flac"
    stored, _ = sf.read(io.BytesIO(audio.content), dtype="int16")
    original, _ = sf.read(io.BytesIO(wav_bytes(samples)), dtype="int16")
    assert np.array_equal(stored, original)


def test_take_upload_rejections(client: TestClient, device_id: int, settings: Settings) -> None:
    not_audio = upload(client, device_id, b"hello")
    assert not_audio.status_code == 400
    assert "audio" in not_audio.json()["error"]
    assert upload(client, 999).status_code == 422
    assert upload(client, device_id, intent="loud").status_code == 422
    bad_ref = upload(client, device_id, content_ref="passage:nope@1")
    assert bad_ref.status_code == 422
    assert "passage:nope@1" in bad_ref.json()["error"]
    missing = client.post("/api/v1/takes", data={"meta": "{}"})
    assert missing.status_code == 422
    assert client.get("/api/v1/takes").json() == []
    assert not list(settings.audio_dir.rglob("*.flac"))


def test_take_list_filters_and_order(client: TestClient, device_id: int) -> None:
    upload(client, device_id, recorded_at="2026-11-01T10:00:00Z")
    upload(client, device_id, language="cs", recorded_at="2026-11-03T10:00:00Z")
    upload(
        client,
        device_id,
        wav_bytes(tone(f0=200.0)),
        item="vowels",
        intent="attempt",
        language=None,
        recorded_at="2026-11-02T10:00:00Z",
    )
    everything = client.get("/api/v1/takes").json()
    assert [t["recorded_at"][:10] for t in everything] == ["2026-11-03", "2026-11-02", "2026-11-01"]
    assert len(client.get("/api/v1/takes", params={"language": "cs"}).json()) == 1
    assert len(client.get("/api/v1/takes", params={"item": "vowels"}).json()) == 1
    assert len(client.get("/api/v1/takes", params={"intent": "habitual"}).json()) == 2
    assert len(client.get("/api/v1/takes", params={"device_id": device_id, "limit": 2}).json()) == 2
    assert client.get("/api/v1/takes", params={"item": "yodel"}).status_code == 422


def test_take_patch(client: TestClient, device_id: int) -> None:
    take = upload(client, device_id).json()
    patched = client.patch(
        f"/api/v1/takes/{take['id']}",
        json={"intent": "attempt", "note": "raised", "language": None},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["intent"], body["note"], body["language"]) == ("attempt", "raised", None)
    assert body["item"] == "passage"
    assert client.patch(f"/api/v1/takes/{take['id']}", json={"device_id": 999}).status_code == 422
    assert client.patch(f"/api/v1/takes/{take['id']}", json={"intent": None}).status_code == 422
    assert client.patch("/api/v1/takes/nope", json={"note": "x"}).status_code == 404


def test_take_delete_keeps_shared_audio(
    client: TestClient, device_id: int, settings: Settings
) -> None:
    first = upload(client, device_id).json()
    second = upload(client, device_id, intent="attempt").json()
    assert first["sha256"] == second["sha256"]
    assert client.delete(f"/api/v1/takes/{first['id']}").status_code == 204
    assert len(list(settings.audio_dir.rglob("*.flac"))) == 1
    assert client.get(f"/api/v1/takes/{second['id']}/audio").status_code == 200
    assert client.delete(f"/api/v1/takes/{second['id']}").status_code == 204
    assert not list(settings.audio_dir.rglob("*.flac"))
    assert client.get(f"/api/v1/takes/{second['id']}").status_code == 404
    assert client.get("/api/v1/health").json()["pending_jobs"] == 0


def test_content_and_metrics(client: TestClient) -> None:
    content = client.get("/api/v1/content").json()
    refs = {f"passage:{p['id']}@{p['version']}" for p in content["passages"]}
    assert {"passage:garden-en@1", "passage:garden-cs@1"} <= refs
    baseline = next(p for p in content["protocols"] if p["id"] == "baseline")
    assert [i["key"] for i in baseline["items"]] == [
        "vowels",
        "glide",
        "passage-en",
        "passage-cs",
        "free-en",
        "free-cs",
    ]
    metrics = client.get("/api/v1/metrics").json()
    assert {m["key"] for m in metrics} == KEYS
    assert all(m["titles"].keys() >= {"en", "cs"} for m in metrics)


def test_passage_text_is_frozen(client: TestClient) -> None:
    # NOTE: takes exist for version 1; a changed text must become version 2
    passages = {p["id"]: p["text"] for p in client.get("/api/v1/content").json()["passages"]}
    digests = {k: hashlib.sha256(v.encode()).hexdigest() for k, v in passages.items()}
    assert digests["garden-en"].startswith("492ab02d8bec0424")
    assert digests["garden-cs"].startswith("13dfbf086efc9c7f")
    assert passages["garden-en"].startswith("Every evening, a warm wind moves along the river")
    assert passages["garden-cs"].endswith("anebo zůstaneme tady a budeme si zpívat.")


def test_web_types_are_current() -> None:
    # regenerate with: python -m puptrainer.api.tstypes > web/src/lib/api/types.ts
    default = REPO / "web" / "src" / "lib" / "api" / "types.ts"
    committed = Path(os.environ.get("PUPTRAINER_TS_TYPES", default))
    assert committed.read_text(encoding="utf-8") == tstypes.current()


def test_repeated_upload_with_a_client_id_stores_one_take(
    client: TestClient, device_id: int, settings: Settings
) -> None:
    first = upload(client, device_id, client_id="queue-item-0001")
    again = upload(client, device_id, client_id="queue-item-0001", note="a retry")
    other = upload(client, device_id, client_id="queue-item-0002")
    assert (first.status_code, again.status_code, other.status_code) == (201, 200, 201)
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["note"] == ""
    assert other.json()["id"] != first.json()["id"]
    assert len(client.get("/api/v1/takes").json()) == 2
    assert client.get("/api/v1/health").json()["pending_jobs"] == 2
    assert upload(client, device_id, client_id="short").status_code == 422
