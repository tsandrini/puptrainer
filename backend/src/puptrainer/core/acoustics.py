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


R1_MAX_LIGHTNESS_DB = 12.0
"""From this lead of the fundamental over the second harmonic on, an F1 found by linear
prediction is not the first resonance: the analysis is drawn to the fundamental, or to a
harmonic near where the resonance was (it read 290-470 Hz on a held "ah" whose F1 had
been 640 Hz a moment before, at 14-17 dB)."""
R1_MAX_UNREADABLE_PCT = 25.0
"""From this share of frames whose F1 cannot be told from the pitch on, a take's median
F1 follows the pitch: the learner's everyday speech has 4-19%, their attempts 33-49%."""
PITCH_RATIO = 1.25
"""An F1 below this many times the pitch is the pitch itself."""


def r1_readable(lightness_db: float | None, unreadable_pct: float | None) -> bool:
    """Whether the first resonance of a sound, as linear prediction reads it, can be trusted.

    Args:
        lightness_db: How far the fundamental stands above the second harmonic.
        unreadable_pct: The share of the sound's frames whose F1 cannot be told from the
            pitch.

    Returns:
        False when either says the reading follows the pitch; a value that was not
        measured (an older analysis) is given the benefit of the doubt.
    """
    light = lightness_db is not None and lightness_db >= R1_MAX_LIGHTNESS_DB
    blurred = unreadable_pct is not None and unreadable_pct >= R1_MAX_UNREADABLE_PCT
    return not (light or blurred)
