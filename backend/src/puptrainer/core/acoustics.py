"""Small acoustic helpers shared by the pipeline and the evaluation of exercises."""

from collections.abc import Sequence

import numpy as np

SPEED_OF_SOUND_CM_S = 35000.0


def semitones(high: float, low: float) -> float:
    """The interval from `low` up to `high`, in semitones."""
    return 12.0 * float(np.log2(high / low))


def cents(value: float, reference: float) -> float:
    """How far `value` lies above `reference`, in cents (hundredths of a semitone)."""
    return 1200.0 * float(np.log2(value / reference))


BRIGHT = slice(1, 4)
"""The formants brightness is read from, F2 to F4: F1 follows the jaw and loudness as much
as the tract, so it is reported apart."""


def brightness_pct(formants: Sequence[float], reference: Sequence[float]) -> float:
    """How much higher F2 to F4 sit than in `reference`, in percent (geometric mean).

    Args:
        formants: F1 to F4 of a sound.
        reference: F1 to F4 of the sound it is read against.
    """
    ratios = np.divide(formants[BRIGHT], reference[BRIGHT])
    return 100.0 * (float(np.exp(np.mean(np.log(ratios)))) - 1.0)


def first_pct(formants: Sequence[float], reference: Sequence[float]) -> float:
    """How much higher F1 sits than in `reference`, in percent."""
    return 100.0 * (formants[0] / reference[0] - 1.0)


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
