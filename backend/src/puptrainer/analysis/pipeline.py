"""Pipeline v0: recording quality and median pitch.

Every key returned here is in `puptrainer.core.metrics.REGISTRY`. A metric that cannot
be measured (pitch of a silent take) is left out, never reported as a placeholder.
"""

from pathlib import Path

import numpy as np
import parselmouth

from puptrainer.core.schemas import Item

PIPELINE_VERSION = "0.1.0"

TIME_STEP_S = 0.01
FRAME_S = 0.02
PITCH_FLOOR_HZ = 60.0
PITCH_CEILING_HZ = 800.0
# NOTE: Praat's default (0.01) follows subharmonics down an octave in creaky voice
OCTAVE_COST = 0.1
ADAPTIVE_FLOOR = 0.7
MIN_VOICED_FRAMES = 10


def decibels(amplitude: float) -> float:
    """An amplitude relative to full scale, in dB, floored at -120."""
    return 20.0 * float(np.log10(max(amplitude, 1e-6)))


def level_metrics(samples: np.ndarray, sample_rate: float) -> dict[str, float]:
    """Peak, clipping, speech level and noise floor of a mono signal in [-1, 1].

    Args:
        samples: The signal.
        sample_rate: Samples per second.

    Returns:
        `peak_dbfs`, `clipped_samples`, and, for takes of at least ten 20 ms frames,
        `speech_level_dbfs` (90th percentile of frame RMS) and `noise_floor_dbfs` (5th).
    """
    out = {
        "peak_dbfs": decibels(float(np.abs(samples).max())),
        "clipped_samples": float((np.abs(samples) >= 0.999).sum()),
    }
    frame = int(FRAME_S * sample_rate)
    count = len(samples) // frame
    if count >= 10:
        rms = np.sqrt((samples[: count * frame].reshape(count, frame) ** 2).mean(axis=1))
        out["speech_level_dbfs"] = decibels(float(np.percentile(rms, 90)))
        out["noise_floor_dbfs"] = decibels(float(np.percentile(rms, 5)))
    return out


def voiced_pitch(sound: parselmouth.Sound, floor: float) -> tuple[np.ndarray, int]:
    """Pitch of the voiced frames, and the number of frames analysed."""
    pitch = sound.to_pitch_ac(
        time_step=TIME_STEP_S,
        pitch_floor=floor,
        pitch_ceiling=PITCH_CEILING_HZ,
        octave_cost=OCTAVE_COST,
    )
    values = pitch.selected_array["frequency"]
    return values[values > 0], len(values)


def pitch_metrics(sound: parselmouth.Sound, item: Item) -> dict[str, float]:
    """Voiced share and median pitch.

    Pitch is tracked twice: once over the full range, then with the floor raised to 0.7
    times the first median, so that frames with a subharmonic (creak, period doubling)
    are read at the pitch of the voice and not an octave below it. A glide covers the
    whole range on purpose and is tracked once.

    Args:
        sound: The take, mono.
        item: What the take contains.

    Returns:
        `voiced_fraction` always; `pitch_median_hz` when at least ten frames are voiced.
    """
    voiced, frames = voiced_pitch(sound, PITCH_FLOOR_HZ)
    out = {"voiced_fraction": len(voiced) / frames if frames else 0.0}
    if len(voiced) < MIN_VOICED_FRAMES:
        return out
    median = float(np.median(voiced))
    if item != Item.GLIDE:
        floor = max(PITCH_FLOOR_HZ, ADAPTIVE_FLOOR * median)
        second, _ = voiced_pitch(sound, floor)
        if len(second) >= MIN_VOICED_FRAMES:
            median = float(np.median(second))
    out["pitch_median_hz"] = median
    return out


def analyse(path: Path, item: Item) -> dict[str, float]:
    """Measure one take.

    Args:
        path: The recording (any format Praat reads; the API serves FLAC).
        item: What the take contains.

    Returns:
        Metric values by registry key.

    Raises:
        parselmouth.PraatError: The file cannot be read as audio.
    """
    sound = parselmouth.Sound(str(path))
    if sound.n_channels > 1:
        sound = sound.convert_to_mono()
    samples = sound.values[0]
    return {
        "duration_s": float(sound.duration),
        **level_metrics(samples, sound.sampling_frequency),
        **pitch_metrics(sound, item),
    }
