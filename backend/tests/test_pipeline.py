from pathlib import Path

import numpy as np
import parselmouth
import pytest
import soundfile as sf

from puptrainer.analysis.pipeline import analyse
from puptrainer.core.metrics import KEYS
from puptrainer.core.schemas import Item

from .conftest import SAMPLE_RATE, tone


def write(tmp_path: Path, samples: np.ndarray) -> Path:
    path = tmp_path / "take.flac"
    sf.write(path, samples, SAMPLE_RATE, subtype="PCM_24")
    return path


def test_keys_are_registered(tmp_path: Path) -> None:
    metrics = analyse(write(tmp_path, tone()), Item.PASSAGE)
    assert set(metrics) == KEYS
    assert all(np.isfinite(v) for v in metrics.values())


@pytest.mark.parametrize("f0", [95.0, 170.0, 240.0, 330.0])
def test_median_pitch_of_a_steady_tone(tmp_path: Path, f0: float) -> None:
    metrics = analyse(write(tmp_path, tone(f0=f0)), Item.VOWELS)
    assert metrics["pitch_median_hz"] == pytest.approx(f0, rel=0.01)
    assert metrics["voiced_fraction"] > 0.9


def test_subharmonic_voice_is_not_read_an_octave_low(tmp_path: Path) -> None:
    samples = tone(f0=172.0, subharmonic=0.2)
    path = write(tmp_path, samples)
    # the case this guards against: Praat's defaults follow the subharmonic
    default = parselmouth.Sound(str(path)).to_pitch_ac(pitch_floor=60.0)
    naive = default.selected_array["frequency"]
    assert np.median(naive[naive > 0]) == pytest.approx(86.0, abs=2.0)
    assert analyse(path, Item.VOWELS)["pitch_median_hz"] == pytest.approx(172.0, abs=2.0)


def test_levels(tmp_path: Path) -> None:
    quiet = np.concatenate([np.zeros(SAMPLE_RATE), tone(amplitude=0.5), np.zeros(SAMPLE_RATE)])
    quiet = quiet + 1e-4 * np.random.default_rng(1).standard_normal(len(quiet))
    metrics = analyse(write(tmp_path, quiet), Item.PASSAGE)
    assert metrics["duration_s"] == pytest.approx(4.0)
    assert metrics["peak_dbfs"] == pytest.approx(-6.0, abs=0.1)
    assert metrics["clipped_samples"] == 0
    assert metrics["noise_floor_dbfs"] == pytest.approx(-80.0, abs=3.0)
    assert -20.0 < metrics["speech_level_dbfs"] < -8.0
    assert metrics["voiced_fraction"] == pytest.approx(0.5, abs=0.05)


def test_clipping_is_counted(tmp_path: Path) -> None:
    clipped = np.clip(tone(amplitude=1.0) * 1.5, -1.0, 1.0)
    metrics = analyse(write(tmp_path, clipped), Item.PASSAGE)
    assert metrics["clipped_samples"] > 100
    assert metrics["peak_dbfs"] == pytest.approx(0.0, abs=0.01)


def test_silence_has_no_pitch(tmp_path: Path) -> None:
    metrics = analyse(write(tmp_path, np.zeros(2 * SAMPLE_RATE)), Item.FREE)
    assert "pitch_median_hz" not in metrics
    assert metrics["voiced_fraction"] == 0.0
    assert metrics["peak_dbfs"] == -120.0


def test_stereo_is_mixed_for_analysis(tmp_path: Path) -> None:
    stereo = np.stack([tone(f0=200.0), tone(f0=200.0)], axis=1)
    assert analyse(write(tmp_path, stereo), Item.FREE)["pitch_median_hz"] == pytest.approx(
        200.0, rel=0.01
    )


def test_glide_keeps_its_low_notes(tmp_path: Path) -> None:
    low = tone(f0=100.0, seconds=1.5)
    high = tone(f0=400.0, seconds=1.0)
    path = write(tmp_path, np.concatenate([low, high]))
    # the adaptive floor would cut nothing here, but a glide must never be tracked twice
    assert analyse(path, Item.GLIDE)["pitch_median_hz"] == pytest.approx(100.0, rel=0.02)


def test_unreadable_file_raises(tmp_path: Path) -> None:
    path = tmp_path / "take.flac"
    path.write_bytes(b"nope")
    with pytest.raises(parselmouth.PraatError):
        analyse(path, Item.FREE)
