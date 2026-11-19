from pathlib import Path

import numpy as np
import parselmouth
import pytest
import soundfile as sf

from puptrainer.analysis.pipeline import analyse, spacing
from puptrainer.core.metrics import KEYS, REGISTRY
from puptrainer.core.schemas import Item

from .conftest import SAMPLE_RATE, tone, vowel

NEUTRAL = (500.0, 1500.0, 2500.0, 3500.0, 4500.0)  # a 17.5 cm tube
SHORTER = (570.0, 1710.0, 2850.0, 3990.0, 5130.0)  # a 15.35 cm tube
SHORT = (625.0, 1875.0, 3125.0, 4375.0, 5625.0)  # a 14 cm tube


def write(tmp_path: Path, samples: np.ndarray) -> Path:
    path = tmp_path / "take.flac"
    sf.write(path, samples, SAMPLE_RATE, subtype="PCM_24")
    return path


def measure(tmp_path: Path, samples: np.ndarray, item: Item = Item.PASSAGE) -> dict[str, float]:
    return analyse(write(tmp_path, samples), item).metrics


@pytest.mark.parametrize("item", list(Item))
def test_metrics_are_registered_and_belong_to_the_item(tmp_path: Path, item: Item) -> None:
    metrics = measure(tmp_path, vowel(NEUTRAL), item)
    assert set(metrics) <= KEYS
    assert all(np.isfinite(v) for v in metrics.values())
    allowed = {m.key for m in REGISTRY if m.items is None or item in m.items}
    assert set(metrics) <= allowed
    assert {"duration_s", "peak_dbfs", "voiced_share_pct"} <= set(metrics)
    assert ("glide_range_st" if item == Item.GLIDE else "pitch_median_hz") in metrics


def test_speech_take_has_every_speech_metric(tmp_path: Path) -> None:
    metrics = measure(tmp_path, vowel(NEUTRAL), Item.FREE)
    expected = {m.key for m in REGISTRY if m.items is None or Item.FREE in m.items}
    assert set(metrics) == expected


@pytest.mark.parametrize("f0", [95.0, 170.0, 240.0, 330.0])
def test_median_pitch_of_a_steady_tone(tmp_path: Path, f0: float) -> None:
    metrics = measure(tmp_path, tone(f0=f0), Item.VOWELS)
    assert metrics["pitch_median_hz"] == pytest.approx(f0, rel=0.01)
    assert metrics["voiced_share_pct"] > 90
    assert metrics["subharmonic_share_pct"] == 0


def test_subharmonic_voice_is_not_read_an_octave_low(tmp_path: Path) -> None:
    path = write(tmp_path, tone(f0=172.0, subharmonic=0.2))
    # the case this guards against: Praat's defaults follow the subharmonic
    default = parselmouth.Sound(str(path)).to_pitch_ac(pitch_floor=60.0)
    naive = default.selected_array["frequency"]
    assert np.median(naive[naive > 0]) == pytest.approx(86.0, abs=2.0)
    metrics = analyse(path, Item.VOWELS).metrics
    assert metrics["pitch_median_hz"] == pytest.approx(172.0, abs=2.0)
    assert metrics["subharmonic_share_pct"] > 90


def test_pitch_distribution(tmp_path: Path) -> None:
    low, high = tone(f0=120.0, seconds=1.0), tone(f0=200.0, seconds=1.0)
    metrics = measure(tmp_path, np.concatenate([low, high]), Item.FREE)
    assert metrics["pitch_p05_hz"] == pytest.approx(120.0, rel=0.02)
    assert metrics["pitch_p95_hz"] == pytest.approx(200.0, rel=0.02)
    assert metrics["pitch_range_st"] == pytest.approx(8.84, abs=0.4)
    assert metrics["pitch_sd_st"] == pytest.approx(4.4, abs=0.5)
    assert metrics["pitch_below_145_pct"] == pytest.approx(50, abs=5)
    assert metrics["pitch_145_185_pct"] == pytest.approx(0, abs=5)
    assert metrics["pitch_above_185_pct"] == pytest.approx(50, abs=5)
    shares = ("pitch_below_145_pct", "pitch_145_185_pct", "pitch_above_185_pct")
    assert sum(metrics[k] for k in shares) == pytest.approx(100)

    inside = measure(tmp_path, tone(f0=170.0), Item.PASSAGE)
    assert inside["pitch_145_185_pct"] == 100
    assert inside["pitch_range_st"] == pytest.approx(0, abs=0.2)


def test_tube_spacing() -> None:
    width, length = spacing(list(NEUTRAL))
    assert width == pytest.approx(1000.0)
    assert length == pytest.approx(17.5)


@pytest.mark.parametrize(
    ("formants", "length", "f0"),
    [(NEUTRAL, 17.5, 120.0), (SHORTER, 15.35, 170.0), (SHORT, 14.0, 210.0)],
)
def test_resonance_of_a_synthetic_vowel(
    tmp_path: Path, formants: tuple[float, ...], length: float, f0: float
) -> None:
    metrics = measure(tmp_path, vowel(formants, f0=f0), Item.FREE)
    for index, expected in enumerate(formants[:4], start=1):
        assert metrics[f"f{index}_median_hz"] == pytest.approx(expected, rel=0.05)
    assert metrics["vtl_cm"] == pytest.approx(length, abs=0.5)
    assert metrics["formant_spacing_hz"] == pytest.approx(35000 / (2 * length), rel=0.03)


def test_a_shorter_tract_reads_shorter_at_a_raised_pitch(tmp_path: Path) -> None:
    longer = measure(tmp_path, vowel(NEUTRAL, f0=120.0), Item.FREE)
    shorter = measure(tmp_path, vowel(SHORTER, f0=200.0), Item.FREE)
    assert shorter["vtl_cm"] < longer["vtl_cm"] - 1.2


def test_breath_lowers_the_quality_measures(tmp_path: Path) -> None:
    clear = measure(tmp_path, vowel(NEUTRAL), Item.FREE)
    breathy = measure(tmp_path, vowel(NEUTRAL, noise=0.15), Item.FREE)
    assert clear["cpps_db"] > breathy["cpps_db"] + 2
    assert clear["hnr_db"] > breathy["hnr_db"] + 5
    assert breathy["spectral_slope_db"] > clear["spectral_slope_db"]
    assert breathy["pitch_median_hz"] == pytest.approx(120.0, rel=0.03)


def test_vowels_take_is_measured_per_vowel(tmp_path: Path) -> None:
    gap = np.zeros(SAMPLE_RATE // 2)
    a = vowel((750.0, 1200.0, 2500.0, 3500.0, 4500.0), f0=170.0, wobble=0.0)
    i = vowel((280.0, 2250.0, 2900.0, 3600.0, 4500.0), f0=172.0, wobble=0.0)
    u = vowel((310.0, 800.0, 2300.0, 3400.0, 4400.0), f0=174.0, wobble=0.0)
    analysis = analyse(write(tmp_path, np.concatenate([gap, a, gap, i, gap, u, gap])), Item.VOWELS)
    found = analysis.details.vowels
    assert [v.vowel for v in found] == ["a", "i", "u"]
    assert [round(v.pitch_hz) for v in found] == [170, 172, 174]
    assert all(v.duration_s == pytest.approx(2.0, abs=0.1) for v in found)
    assert found[0].start_s == pytest.approx(0.5, abs=0.05)
    assert found[0].formants_hz[0] == pytest.approx(750.0, rel=0.08)
    assert found[1].formants_hz[1] == pytest.approx(2250.0, rel=0.08)
    assert all(v.cpps_db > 10 and v.hnr_db > 10 for v in found)
    assert "vtl_cm" in analysis.metrics
    assert "f1_median_hz" not in analysis.metrics


def test_short_voiced_stretches_are_not_vowels(tmp_path: Path) -> None:
    gap = np.zeros(SAMPLE_RATE // 4)
    blips = np.concatenate([gap, tone(seconds=0.6), gap, tone(seconds=0.6), gap])
    assert analyse(write(tmp_path, blips), Item.VOWELS).details.vowels == []


def test_glide_range(tmp_path: Path) -> None:
    seconds = 4.0
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    f = 100.0 * (4.0 ** (t / seconds))  # 100 Hz up to 400 Hz, two octaves
    phase = 2 * np.pi * np.cumsum(f) / SAMPLE_RATE
    chirp = 0.18 * np.sum([np.sin(k * phase) / k for k in range(1, 8)], axis=0)
    metrics = measure(tmp_path, chirp, Item.GLIDE)
    assert metrics["glide_low_hz"] == pytest.approx(103.0, rel=0.05)
    assert metrics["glide_high_hz"] == pytest.approx(389.0, rel=0.05)
    assert metrics["glide_range_st"] == pytest.approx(23.0, abs=1.5)
    assert "vtl_cm" not in metrics and "pitch_median_hz" not in metrics


def test_pitch_contour_is_stored(tmp_path: Path) -> None:
    samples = np.concatenate([np.zeros(SAMPLE_RATE), tone(f0=150.0), np.zeros(SAMPLE_RATE)])
    contour = analyse(write(tmp_path, samples), Item.FREE).series["pitch_hz"]
    assert contour.step_s == 0.01
    assert len(contour.values) == pytest.approx(400, abs=10)
    voiced = [v for v in contour.values if v is not None]
    assert len(voiced) == pytest.approx(200, abs=10)
    assert np.median(voiced) == pytest.approx(150.0, abs=1.0)
    # silence before and after the tone is unvoiced
    assert contour.values[20] is None and contour.values[-20] is None


def test_levels(tmp_path: Path) -> None:
    quiet = np.concatenate([np.zeros(SAMPLE_RATE), tone(amplitude=0.5), np.zeros(SAMPLE_RATE)])
    quiet = quiet + 1e-4 * np.random.default_rng(1).standard_normal(len(quiet))
    metrics = measure(tmp_path, quiet)
    assert metrics["duration_s"] == pytest.approx(4.0)
    assert metrics["peak_dbfs"] == pytest.approx(-6.0, abs=0.1)
    assert metrics["clipped_samples"] == 0
    assert metrics["noise_floor_dbfs"] == pytest.approx(-80.0, abs=3.0)
    assert -20.0 < metrics["speech_level_dbfs"] < -8.0
    assert metrics["voiced_share_pct"] == pytest.approx(50, abs=5)


def test_clipping_is_counted(tmp_path: Path) -> None:
    clipped = np.clip(tone(amplitude=1.0) * 1.5, -1.0, 1.0)
    metrics = measure(tmp_path, clipped)
    assert metrics["clipped_samples"] > 100
    assert metrics["peak_dbfs"] == pytest.approx(0.0, abs=0.01)


def test_silence_has_only_recording_metrics(tmp_path: Path) -> None:
    analysis = analyse(write(tmp_path, np.zeros(2 * SAMPLE_RATE)), Item.FREE)
    assert set(analysis.metrics) == {
        "duration_s",
        "peak_dbfs",
        "clipped_samples",
        "speech_level_dbfs",
        "noise_floor_dbfs",
        "voiced_share_pct",
    }
    assert analysis.metrics["voiced_share_pct"] == 0
    assert analysis.metrics["peak_dbfs"] == -120.0
    assert all(v is None for v in analysis.series["pitch_hz"].values)


def test_stereo_is_mixed_for_analysis(tmp_path: Path) -> None:
    stereo = np.stack([tone(f0=200.0), tone(f0=200.0)], axis=1)
    assert measure(tmp_path, stereo, Item.FREE)["pitch_median_hz"] == pytest.approx(200, rel=0.01)


def test_unreadable_file_raises(tmp_path: Path) -> None:
    path = tmp_path / "take.flac"
    path.write_bytes(b"nope")
    with pytest.raises(parselmouth.PraatError):
        analyse(path, Item.FREE)


def test_phrase_take_has_every_speech_metric(tmp_path: Path) -> None:
    metrics = measure(tmp_path, vowel(NEUTRAL), Item.PHRASE)
    expected = {m.key for m in REGISTRY if m.items is None or Item.PHRASE in m.items}
    assert set(metrics) == expected


def test_sustain_take_is_measured_per_held_sound(tmp_path: Path) -> None:
    gap = np.zeros(int(0.6 * SAMPLE_RATE))
    steps = [vowel(f, f0=180.0, seconds=2.5, wobble=0.0) for f in (NEUTRAL, SHORTER, SHORT)]
    take = np.concatenate([steps[0], gap, steps[1], gap, steps[2]])
    analysis = analyse(write(tmp_path, take), Item.SUSTAIN)
    held = analysis.details.segments
    assert analysis.details.vowels == []
    assert len(held) == 3
    assert all(s.vowel is None for s in held)
    assert all(s.pitch_hz == pytest.approx(180.0, rel=0.02) for s in held)
    spacings = [spacing(s.formants_hz)[0] for s in held]
    assert spacings[0] < spacings[1] < spacings[2]
    assert "f1_median_hz" not in analysis.metrics
    assert analysis.metrics["subharmonic_share_pct"] == 0


def glide(points: list[tuple[float, float]], seconds: float) -> np.ndarray:
    """A harmonic tone whose pitch follows `points` (time in 0..1, Hz), log-interpolated."""
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    where, hz = zip(*points, strict=True)
    f0 = np.exp(np.interp(t / seconds, where, np.log(hz)))
    phase = 2 * np.pi * np.cumsum(f0) / SAMPLE_RATE
    x = sum(np.sin(k * phase) / k for k in range(1, 16))
    return 0.3 * x / np.abs(x).max()


@pytest.mark.parametrize(
    ("points", "breaks"),
    [
        ([(0.0, 110.0), (1.0, 330.0)], 0),
        ([(0.0, 110.0), (0.5, 160.0), (0.501, 240.0), (1.0, 330.0)], 1),
        (
            [
                (0.0, 110.0),
                (0.3, 150.0),
                (0.301, 220.0),
                (0.7, 250.0),
                (0.701, 180.0),
                (1.0, 200.0),
            ],
            2,
        ),
        ([(0.0, 110.0), (0.5, 150.0), (0.501, 300.0), (1.0, 330.0)], 0),
    ],
    ids=["smooth", "one-flip", "two-flips", "octave-jump"],
)
def test_glide_breaks(tmp_path: Path, points: list[tuple[float, float]], breaks: int) -> None:
    metrics = measure(tmp_path, glide(points, seconds=4.0), Item.GLIDE)
    assert metrics["glide_breaks"] == breaks


def test_no_formants_above_300_hz(tmp_path: Path) -> None:
    # NOTE: found on a real take: a held 671 Hz read "formants" at its own harmonics
    squeak = vowel(SHORT, f0=420.0, seconds=2.5, wobble=0.0)
    speech = measure(tmp_path, squeak, Item.PHRASE)
    assert speech["pitch_median_hz"] == pytest.approx(420.0, rel=0.02)
    assert not {"vtl_cm", "formant_spacing_hz", "f1_median_hz"} & set(speech)
    assert "cpps_db" in speech

    gap = np.zeros(int(0.6 * SAMPLE_RATE))
    low = vowel(NEUTRAL, f0=180.0, seconds=2.5, wobble=0.0)
    analysis = analyse(write(tmp_path, np.concatenate([low, gap, squeak])), Item.SUSTAIN)
    first, second = analysis.details.segments
    assert len(first.formants_hz) == 4 and second.formants_hz == []
    assert second.pitch_hz == pytest.approx(420.0, rel=0.02)
    assert analysis.metrics["vtl_cm"] == pytest.approx(17.5, abs=0.5)
    assert analyse(write(tmp_path, squeak), Item.VOWELS).details.vowels == []


def test_held_sounds_are_fitted_one_by_one(tmp_path: Path) -> None:
    # NOTE: a dark and a bright sound differ in length on purpose; one ceiling fits neither
    gap = np.zeros(int(0.6 * SAMPLE_RATE))
    take = np.concatenate(
        [vowel(NEUTRAL, f0=180.0, seconds=2.5), gap, vowel(SHORT, f0=180.0, seconds=2.5)]
    )
    dark, bright = analyse(write(tmp_path, take), Item.SUSTAIN).details.segments
    assert spacing(dark.formants_hz)[1] == pytest.approx(17.5, abs=0.5)
    assert spacing(bright.formants_hz)[1] == pytest.approx(14.0, abs=0.5)
