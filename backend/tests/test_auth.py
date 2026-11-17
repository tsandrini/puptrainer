from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from puptrainer.analysis.worker import run_once
from puptrainer.api.app import create_app
from puptrainer.core.settings import Settings

from .conftest import upload

TOKEN = "correct-horse-battery-staple"
BEARER = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def locked(settings: Settings) -> Settings:
    return settings.model_copy(update={"token": TOKEN})


@pytest.fixture
def anonymous(locked: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(locked)) as client:
        yield client


def test_open_api_needs_no_sign_in(client: TestClient) -> None:
    assert client.get("/api/v1/session").json() == {"login_required": False, "signed_in": True}
    assert client.get("/api/v1/takes").status_code == 200
    # signing in to an open API is a no-op, not an error
    assert client.post("/api/v1/login", json={"token": "anything"}).status_code == 204


def test_locked_api_refuses_without_the_token(anonymous: TestClient) -> None:
    assert anonymous.get("/api/v1/session").json() == {"login_required": True, "signed_in": False}
    assert anonymous.get("/api/v1/health").status_code == 200
    for path in ("takes", "devices", "content", "metrics", "takes/abc/audio"):
        response = anonymous.get(f"/api/v1/{path}")
        assert response.status_code == 401, path
        assert "token" in response.json()["error"]
    assert anonymous.post("/api/v1/devices", json={"name": "x"}).status_code == 401
    assert anonymous.post("/api/v1/worker/jobs/claim").status_code == 401
    assert anonymous.post("/api/v1/analysis/requeue").status_code == 401
    wrong = {"Authorization": "Bearer nope"}
    assert anonymous.get("/api/v1/takes", headers=wrong).status_code == 401


def test_sign_in_sets_a_cookie_that_opens_the_api(anonymous: TestClient) -> None:
    wrong = anonymous.post("/api/v1/login", json={"token": "nope"})
    assert wrong.status_code == 401
    assert "set-cookie" not in wrong.headers
    right = anonymous.post("/api/v1/login", json={"token": f"  {TOKEN}\n"})
    assert right.status_code == 204
    cookie = right.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert TOKEN not in cookie
    assert "Secure" not in cookie
    assert anonymous.get("/api/v1/session").json() == {"login_required": True, "signed_in": True}

    device = anonymous.post("/api/v1/devices", json={"name": "lavalier"}).json()["id"]
    take = upload(anonymous, device).json()
    # the player sends the cookie, not a header
    assert anonymous.get(f"/api/v1/takes/{take['id']}/audio").status_code == 200

    assert anonymous.post("/api/v1/logout").status_code == 204
    assert anonymous.get("/api/v1/takes").status_code == 401


def test_cookie_is_secure_behind_https(anonymous: TestClient) -> None:
    proxied = anonymous.post(
        "/api/v1/login", json={"token": TOKEN}, headers={"X-Forwarded-Proto": "https"}
    )
    assert "Secure" in proxied.headers["set-cookie"]


def test_bearer_token_opens_the_api(anonymous: TestClient) -> None:
    assert anonymous.get("/api/v1/takes", headers=BEARER).status_code == 200
    assert anonymous.get("/api/v1/session", headers=BEARER).json()["signed_in"] is True


def test_worker_needs_the_token(locked: Settings) -> None:
    app = create_app(locked)
    with TestClient(app, headers=BEARER) as worker, TestClient(app) as stranger:
        device = worker.post("/api/v1/devices", json={"name": "lavalier"}).json()["id"]
        take = upload(worker, device).json()
        with pytest.raises(httpx.HTTPStatusError):
            run_once(stranger)
        assert run_once(worker) is True
        assert worker.get(f"/api/v1/takes/{take['id']}").json()["analysis"]["status"] == "done"


def test_token_file(settings: Settings, tmp_path: Path) -> None:
    path = tmp_path / "token"
    path.write_text(f"{TOKEN}\n", encoding="utf-8")
    from_file = settings.model_copy(update={"token_file": path, "token": "ignored"})
    assert from_file.access_token == TOKEN
    with TestClient(create_app(from_file)) as client:
        assert client.get("/api/v1/takes").status_code == 401
        assert client.get("/api/v1/takes", headers=BEARER).status_code == 200
    path.write_text("\n", encoding="utf-8")
    with pytest.raises(ValueError, match="empty"):
        _ = from_file.access_token
    assert settings.access_token is None
