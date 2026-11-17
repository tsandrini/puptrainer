import io
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from puptrainer.api.storage import AudioStore, InvalidAudioError

from .conftest import SAMPLE_RATE, tone, wav_bytes


def test_16_bit_round_trip_is_sample_exact(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    data = wav_bytes(tone(), "PCM_16")
    info = store.ingest(data)
    original, _ = sf.read(io.BytesIO(data), dtype="int16")
    stored, rate = sf.read(store.path(info.sha256), dtype="int16")
    assert rate == info.sample_rate == SAMPLE_RATE
    assert info.channels == 1
    assert info.duration_s == pytest.approx(2.0)
    assert sf.info(store.path(info.sha256)).subtype == "PCM_16"
    assert np.array_equal(original, stored)


def test_24_bit_round_trip_is_sample_exact(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    data = wav_bytes(tone(), "PCM_24")
    info = store.ingest(data)
    original, _ = sf.read(io.BytesIO(data), dtype="int32")
    stored, _ = sf.read(store.path(info.sha256), dtype="int32")
    assert sf.info(store.path(info.sha256)).subtype == "PCM_24"
    assert np.array_equal(original, stored)


def test_float_input_is_stored_as_24_bit(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    samples = tone()
    info = store.ingest(wav_bytes(samples, "FLOAT"))
    stored, _ = sf.read(store.path(info.sha256), dtype="float64")
    assert sf.info(store.path(info.sha256)).subtype == "PCM_24"
    assert np.abs(stored - samples).max() < 2 / 2**23


def test_same_samples_are_stored_once(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    first = store.ingest(wav_bytes(tone()))
    second = store.ingest(wav_bytes(tone()))
    other = store.ingest(wav_bytes(tone(f0=200.0)))
    assert first.sha256 == second.sha256 != other.sha256
    assert len(list(tmp_path.rglob("*.flac"))) == 2


def test_stereo_is_kept_stereo(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    info = store.ingest(wav_bytes(np.stack([tone(), tone(f0=220.0)], axis=1)))
    assert info.channels == 2
    assert sf.info(store.path(info.sha256)).channels == 2


@pytest.mark.parametrize("data", [b"", b"not audio at all", b"RIFF\x00\x00\x00\x00WAVE"])
def test_garbage_is_rejected(tmp_path: Path, data: bytes) -> None:
    with pytest.raises(InvalidAudioError):
        AudioStore(tmp_path).ingest(data)
    assert not list(tmp_path.rglob("*.flac"))


def test_empty_recording_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(InvalidAudioError, match="empty"):
        AudioStore(tmp_path).ingest(wav_bytes(np.zeros(0)))


def test_delete_is_idempotent(tmp_path: Path) -> None:
    store = AudioStore(tmp_path)
    info = store.ingest(wav_bytes(tone()))
    store.delete(info.sha256)
    store.delete(info.sha256)
    assert not store.path(info.sha256).exists()


def test_ingest_needs_no_write_execute_memory(tmp_path: Path) -> None:
    # systemd's MemoryDenyWriteExecute, which the NixOS module sets: the same restriction
    # is switched on in a child process, which then stores an upload
    upload = tmp_path / "upload.wav"
    upload.write_bytes(wav_bytes(tone()))
    script = f"""
import ctypes, sys
from pathlib import Path
PR_SET_MDWE, REFUSE_EXEC_GAIN = 65, 1
if ctypes.CDLL(None, use_errno=True).prctl(PR_SET_MDWE, REFUSE_EXEC_GAIN, 0, 0, 0) != 0:
    sys.exit(77)  # a kernel without the switch
from puptrainer.api.storage import AudioStore
info = AudioStore(Path({str(tmp_path / "store")!r})).ingest(Path({str(upload)!r}).read_bytes())
print(info.sample_rate, info.duration_s)
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)
    if result.returncode == 77:
        pytest.skip("this kernel cannot deny write+execute memory per process")
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["48000", "2.0"]
