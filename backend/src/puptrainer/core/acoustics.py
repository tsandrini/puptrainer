"""Small acoustic helpers shared by the pipeline and the evaluation of exercises."""

import numpy as np

SPEED_OF_SOUND_CM_S = 35000.0


def semitones(high: float, low: float) -> float:
    """The interval from `low` up to `high`, in semitones."""
    return 12.0 * float(np.log2(high / low))


def cents(value: float, reference: float) -> float:
    """How far `value` lies above `reference`, in cents (hundredths of a semitone)."""
    return 1200.0 * float(np.log2(value / reference))


def spacing(formants: list[float]) -> tuple[float, float]:
    """Formant spacing and the apparent vocal-tract length it implies.

    A uniform tube closed at one end resonates at odd multiples of half its spacing,
    F_i = spacing * (2i - 1) / 2; the spacing is fitted to F1–F4 by least squares.

    Returns:
        The spacing in Hz and the tube's length in cm (speed of sound over twice the spacing).
    """
    x = np.array([(2 * i - 1) / 2 for i in range(1, len(formants) + 1)])
    value = float((x @ np.array(formants)) / (x @ x))
    return value, SPEED_OF_SOUND_CM_S / (2.0 * value)
