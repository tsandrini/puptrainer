import io
import os
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

from puptrainer.api.app import create_app
from puptrainer.core.settings import Settings

REPO = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 48000


def tone(
    f0: float = 170.0,
    seconds: float = 2.0,
    amplitude: float = 0.3,
    subharmonic: float = 0.0,
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    """A voice-like harmonic tone; `subharmonic` adds energy at odd multiples of f0/2."""
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    x = np.zeros_like(t)
    for k in range(1, 21):
        x += np.sin(2 * np.pi * k * f0 * t) / k
    if subharmonic:
        for k in range(1, 40, 2):
            x += subharmonic * np.sin(2 * np.pi * k * (f0 / 2) * t + 0.7 * k) / ((k + 1) / 2)
    return amplitude * x / np.abs(x).max()


def wav_bytes(
    samples: np.ndarray, subtype: str = "PCM_16", sample_rate: int = SAMPLE_RATE
) -> bytes:
    """Encode samples in [-1, 1] as a WAV file."""
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV", subtype=subtype)
    return buffer.getvalue()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    content = Path(os.environ.get("PUPTRAINER_CONTENT_DIR", REPO / "content"))
    return Settings(data_dir=tmp_path / "data", content_dir=content, job_timeout_s=600)


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def device_id(client: TestClient) -> int:
    response = client.post("/api/v1/devices", json={"name": "lavalier", "kind": "lavalier"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def upload(client: TestClient, device_id: int, data: bytes | None = None, **labels: object):
    """POST a take; labels default to a habitual English passage."""
    meta = {"device_id": device_id, "item": "passage", "intent": "habitual", "language": "en"}
    meta.update(labels)
    import json

    return client.post(
        "/api/v1/takes",
        files={"file": ("take.wav", data if data is not None else wav_bytes(tone()), "audio/wav")},
        data={"meta": json.dumps(meta)},
    )
