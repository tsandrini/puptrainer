import time

import httpx
import pytest
from fastapi.testclient import TestClient

from puptrainer.analysis.pipeline import PIPELINE_VERSION, Analysis
from puptrainer.analysis.worker import run_once
from puptrainer.api.app import create_app
from puptrainer.core.settings import Settings

from .conftest import tone, upload, wav_bytes


def test_queue_is_empty_at_first(client: TestClient) -> None:
    assert client.post("/api/v1/worker/jobs/claim").status_code == 204
    assert run_once(client) is False
    assert client.get("/api/v1/health").json()["worker_seen_s"] is not None


def test_worker_analyses_a_take(client: TestClient, device_id: int) -> None:
    take = upload(client, device_id, wav_bytes(tone(f0=170.0, amplitude=0.5))).json()
    assert run_once(client) is True
    done = client.get(f"/api/v1/takes/{take['id']}").json()
    assert done["analysis"]["status"] == "done"
    assert done["analysis"]["pipeline_version"] == PIPELINE_VERSION
    assert done["metrics"]["pitch_median_hz"] == pytest.approx(170.0, abs=1.0)
    assert done["metrics"]["peak_dbfs"] == pytest.approx(-6.0, abs=0.1)
    assert done["metrics"]["duration_s"] == pytest.approx(2.0)
    assert run_once(client) is False
    health = client.get("/api/v1/health").json()
    assert health["pending_jobs"] == 0
    assert health["pipeline_version"] == PIPELINE_VERSION

    # the contour is stored and served; a take of speech has no vowels or held sounds
    assert {"pitch_hz", "level_db", "h1h2_db", "cpp_db"} <= set(done["series"])
    assert done["details"] == {"vowels": [], "segments": [], "whisper": []}
    contour = client.get(f"/api/v1/takes/{take['id']}/series/pitch_hz").json()
    assert contour["step_s"] == pytest.approx(0.01)
    voiced = [v for v in contour["values"] if v is not None]
    assert len(contour["values"]) == pytest.approx(200, abs=10)
    assert len(voiced) > 150
    assert sorted(voiced)[len(voiced) // 2] == pytest.approx(170.0, abs=1.0)
    assert client.get(f"/api/v1/takes/{take['id']}/series/nope").status_code == 404

    # the same series as rows over time, a value every tenth of a second
    trace = client.get(f"/api/v1/takes/{take['id']}/trace").json()
    assert trace["step_s"] == pytest.approx(0.1)
    rows = {row["key"]: row["values"] for row in trace["rows"]}
    assert {"pitch_hz", "lightness_db", "clarity_db", "level_db"} <= set(rows)
    assert len(rows["pitch_hz"]) == 20
    assert rows["pitch_hz"][10] == pytest.approx(170.0, abs=1.0)
    assert (trace["zero"], trace["spans"]) == (None, [])
    assert client.get("/api/v1/takes/nope/trace").status_code == 404


def test_a_take_has_no_trace_before_it_is_analysed(client: TestClient, device_id: int) -> None:
    take = upload(client, device_id).json()
    assert client.get(f"/api/v1/takes/{take['id']}/trace").status_code == 404


def test_requeue(client: TestClient, device_id: int) -> None:
    first = upload(client, device_id).json()
    second = upload(client, device_id, wav_bytes(tone(f0=200.0))).json()
    # nothing is queued twice while jobs are waiting
    assert client.post("/api/v1/analysis/requeue").json() == {"queued": 0}
    run_once(client)
    run_once(client)
    # takes analysed by the current pipeline are skipped when a version is named
    current = {"pipeline_version": PIPELINE_VERSION}
    assert client.post("/api/v1/analysis/requeue", params=current).json() == {"queued": 0}
    older = {"pipeline_version": "9.9.9"}
    assert client.post("/api/v1/analysis/requeue", params=older).json() == {"queued": 2}
    assert client.get("/api/v1/health").json()["pending_jobs"] == 2
    waiting = client.get(f"/api/v1/takes/{first['id']}").json()
    assert waiting["analysis"]["status"] == "pending"
    assert "pitch_median_hz" in waiting["metrics"]
    run_once(client)
    run_once(client)
    # without a version, everything is queued again
    assert client.post("/api/v1/analysis/requeue").json() == {"queued": 2}
    assert "pitch_hz" in client.get(f"/api/v1/takes/{second['id']}").json()["series"]


def test_jobs_are_handed_out_once_and_in_order(client: TestClient, device_id: int) -> None:
    first = upload(client, device_id).json()
    second = upload(client, device_id, wav_bytes(tone(f0=200.0))).json()
    claims = [client.post("/api/v1/worker/jobs/claim") for _ in range(3)]
    assert [c.status_code for c in claims] == [200, 200, 204]
    assert [c.json()["take_id"] for c in claims[:2]] == [first["id"], second["id"]]
    assert client.get(f"/api/v1/takes/{first['id']}").json()["analysis"]["status"] == "claimed"


def test_failure_is_recorded_and_can_be_retried(
    client: TestClient, device_id: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    take = upload(client, device_id).json()

    def broken(*_args: object) -> Analysis:
        raise RuntimeError("the file is broken")

    monkeypatch.setattr("puptrainer.analysis.worker.analyse", broken)
    assert run_once(client) is True
    failed = client.get(f"/api/v1/takes/{take['id']}").json()
    assert failed["analysis"]["status"] == "failed"
    assert "the file is broken" in failed["analysis"]["error"]
    assert failed["metrics"] == {}

    monkeypatch.undo()
    retried = client.post(f"/api/v1/takes/{take['id']}/analysis")
    assert retried.status_code == 202
    assert retried.json()["analysis"]["status"] == "pending"
    # asking again while one is queued does not queue a second job
    client.post(f"/api/v1/takes/{take['id']}/analysis")
    assert client.get("/api/v1/health").json()["pending_jobs"] == 1
    assert run_once(client) is True
    assert client.get(f"/api/v1/takes/{take['id']}").json()["analysis"]["status"] == "done"


def test_old_metrics_stay_visible_while_a_new_job_waits(client: TestClient, device_id: int) -> None:
    take = upload(client, device_id).json()
    run_once(client)
    again = client.post(f"/api/v1/takes/{take['id']}/analysis").json()
    assert again["analysis"]["status"] == "pending"
    assert "pitch_median_hz" in again["metrics"]


def test_results_are_validated(client: TestClient, device_id: int) -> None:
    upload(client, device_id)
    job = client.post("/api/v1/worker/jobs/claim").json()["job_id"]
    url = f"/api/v1/worker/jobs/{job}/complete"
    unknown = client.post(url, json={"pipeline_version": "x", "metrics": {"made_up": 1.0}})
    assert unknown.status_code == 422
    assert "made_up" in unknown.json()["error"]
    assert (
        client.post(
            "/api/v1/worker/jobs/999/complete", json={"pipeline_version": "x", "metrics": {}}
        ).status_code
        == 404
    )
    ok = client.post(url, json={"pipeline_version": "x", "metrics": {"duration_s": 2.0}})
    assert ok.status_code == 204
    # a finished job cannot be completed or failed again
    assert client.post(url, json={"pipeline_version": "x", "metrics": {}}).status_code == 409
    fail = client.post(
        f"/api/v1/worker/jobs/{job}/fail", json={"pipeline_version": "x", "error": "late"}
    )
    assert fail.status_code == 409


def test_abandoned_claim_returns_to_the_queue(settings: Settings) -> None:
    impatient = settings.model_copy(update={"job_timeout_s": 0.05})
    with TestClient(create_app(impatient)) as client:
        device = client.post("/api/v1/devices", json={"name": "lavalier"}).json()["id"]
        take = upload(client, device).json()
        first = client.post("/api/v1/worker/jobs/claim").json()
        time.sleep(0.1)
        second = client.post("/api/v1/worker/jobs/claim")
        assert second.status_code == 200
        assert second.json()["job_id"] == first["job_id"]
        assert second.json()["take_id"] == take["id"]


def test_unreachable_api_raises(settings: Settings) -> None:
    with (
        httpx.Client(base_url="http://127.0.0.1:9", timeout=0.5) as client,
        pytest.raises(httpx.HTTPError),
    ):
        run_once(client)
