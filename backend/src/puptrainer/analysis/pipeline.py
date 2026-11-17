"""Pipeline 0.3: recording quality, pitch, resonance, voice quality, range, held sounds.

Every key returned here is in `puptrainer.core.metrics.REGISTRY`. A metric that cannot
be measured (pitch of a silent take) is left out, never reported as a placeholder.
"""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import parselmouth
from parselmouth.praat import call

from puptrainer.core.acoustics import semitones, spacing
from puptrainer.core.schemas import Details, Item, Series, VowelSegment

PIPELINE_VERSION = "0.3.0"

TIME_STEP_S = 0.01
FRAME_S = 0.02
PITCH_FLOOR_HZ = 60.0
PITCH_CEILING_HZ = 800.0
GLIDE_CEILING_HZ = 1200.0
# NOTE: Praat's default (0.01) follows subharmonics down an octave in creaky voice
OCTAVE_COST = 0.1
MIN_VOICED_FRAMES = 10
# NOTE: a frame read at about half the pitch around it is a subharmonic (creak, period
# doubling), not a low note: real drops at the ends of phrases are a few semitones
SUBHARMONIC_RATIO = (0.45, 0.56)
CONTEXT_S = 0.75
LOCAL_FLOOR = 0.7
# NOTE: the usual limits of the band in which listeners disagree about a voice;
# conventions pooled from small studies, not thresholds
BAND_LOW_HZ = 145.0
BAND_HIGH_HZ = 185.0
# NOTE: Burg's method wants five formants below its ceiling, so the ceiling has to follow
# the vocal tract: Praat's defaults (5000 Hz, 5500 Hz) are five times the formant spacing
# of an average man and woman. The ceiling is picked from this grid by that rule.
CEILING_STEP_HZ = 250.0
FORMANT_CEILINGS_HZ = tuple(float(c) for c in range(4500, 6501, int(CEILING_STEP_HZ)))
CEILING_PER_SPACING = 5.0
MAX_BANDWIDTH_HZ = 500.0
MIN_VOWEL_S = 1.5
GLIDE_STRENGTH = 0.8
# NOTE: a register flip moves a few semitones within a frame or two; a jump of about an
# octave is the tracker's octave error at a creaky bottom, not a break
BREAK_ST = 3.0
OCTAVE_ERROR_ST = (11.3, 12.7)
BREAK_GAP_S = 0.05
BREAK_MERGE_S = 0.25
SPEECH_ITEMS = (Item.PHRASE, Item.PASSAGE, Item.FREE, Item.OTHER)


@dataclass
class Analysis:
    """The result of analysing one take.

    Attributes:
        metrics: Values by registry key.
        details: Structured findings (the vowels of a `vowels` take).
        series: Stored series by key (`pitch_hz`).
    """

    metrics: dict[str, float] = field(default_factory=dict)
    details: Details = field(default_factory=Details)
    series: dict[str, Series] = field(default_factory=dict)


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


def track(
    sound: parselmouth.Sound,
    floor: float = PITCH_FLOOR_HZ,
    ceiling: float = PITCH_CEILING_HZ,
    octave_cost: float = OCTAVE_COST,
) -> parselmouth.Pitch:
    """Praat's autocorrelation pitch track at the pipeline's time step."""
    return sound.to_pitch_ac(
        time_step=TIME_STEP_S, pitch_floor=floor, pitch_ceiling=ceiling, octave_cost=octave_cost
    )


@dataclass
class PitchTrack:
    """The pitch of a take, frame by frame.

    Attributes:
        times: Frame times in seconds.
        values: Pitch in Hz, 0 where unvoiced; subharmonic frames are already corrected.
        strength: Praat's periodicity of each frame, 0 to 1.
        subharmonic: Number of voiced frames a default tracker reads an octave low.
    """

    times: np.ndarray
    values: np.ndarray
    strength: np.ndarray
    subharmonic: int = 0

    @property
    def voiced(self) -> np.ndarray:
        """Pitch of the voiced frames."""
        return self.values[self.values > 0]


def pitch_track(sound: parselmouth.Sound, item: Item) -> PitchTrack:
    """Track the pitch and undo octave-low readings of subharmonic frames.

    In creaky voice and period doubling every second vocal-fold cycle differs, and an
    autocorrelation tracker then reports half the pitch. A voiced frame counts as such
    when it reads about half (0.45 to 0.56) of the median pitch within 0.75 s around it;
    where that neighbourhood is itself far below the take's median (under 0.7 of it),
    the take's median is the reference. Such a frame is doubled. A glide covers the
    whole range on purpose: it is tracked with a higher ceiling and left as it is.

    Args:
        sound: The take, mono.
        item: What the take contains.

    Returns:
        The corrected track, with the number of frames that Praat's default settings
        read an octave below it.
    """
    glide = item == Item.GLIDE
    pitch = track(sound, ceiling=GLIDE_CEILING_HZ if glide else PITCH_CEILING_HZ)
    result = PitchTrack(
        times=pitch.xs(),
        values=pitch.selected_array["frequency"].copy(),
        strength=pitch.selected_array["strength"],
    )
    index = np.flatnonzero(result.values > 0)
    if glide or len(index) < MIN_VOICED_FRAMES:
        return result

    times, raw = result.times[index], result.values[index]
    overall = float(np.median(raw))
    low, high = SUBHARMONIC_RATIO
    for position, (time, value) in enumerate(zip(times, raw, strict=True)):
        first, last = np.searchsorted(times, [time - CONTEXT_S, time + CONTEXT_S])
        local = float(np.median(raw[first:last]))
        reference = local if local >= LOCAL_FLOOR * overall else overall
        if low * reference <= value <= high * reference:
            result.values[index[position]] = 2.0 * value

    # what a default tracker makes of the same frames
    naive = track(sound, octave_cost=0.01)
    for frame in index:
        other = naive.get_value_at_time(float(result.times[frame]))
        value = result.values[frame]
        if not np.isnan(other) and low * value <= other <= high * value:
            result.subharmonic += 1
    return result


def pitch_metrics(pitch: PitchTrack, item: Item) -> dict[str, float]:
    """Voiced share, the pitch distribution and the share of subharmonic frames.

    Args:
        pitch: The take's pitch track.
        item: What the take contains; the distribution is reported for speech only.

    Returns:
        `voiced_share_pct` always. With at least ten voiced frames and except for a
        glide: `pitch_median_hz` and `subharmonic_share_pct`. For speech also the 5th and
        95th percentile, the range and standard deviation in semitones, and the shares of
        voiced time below, inside and above the 145–185 Hz band.
    """
    voiced = pitch.voiced
    frames = len(pitch.values)
    out = {"voiced_share_pct": 100.0 * len(voiced) / frames if frames else 0.0}
    if len(voiced) < MIN_VOICED_FRAMES or item == Item.GLIDE:
        return out
    median = float(np.median(voiced))
    out["pitch_median_hz"] = median
    out["subharmonic_share_pct"] = 100.0 * pitch.subharmonic / len(voiced)
    if item in SPEECH_ITEMS:
        p05, p95 = (float(np.percentile(voiced, p)) for p in (5, 95))
        out |= {
            "pitch_p05_hz": p05,
            "pitch_p95_hz": p95,
            "pitch_range_st": semitones(p95, p05),
            "pitch_sd_st": float((12.0 * np.log2(voiced / median)).std()),
            "pitch_below_145_pct": 100.0 * float((voiced < BAND_LOW_HZ).mean()),
            "pitch_145_185_pct": 100.0
            * float(((voiced >= BAND_LOW_HZ) & (voiced <= BAND_HIGH_HZ)).mean()),
            "pitch_above_185_pct": 100.0 * float((voiced > BAND_HIGH_HZ).mean()),
        }
    return out


def glide_metrics(pitch: PitchTrack) -> dict[str, float]:
    """The lowest and highest note of a glide, the range between them, and its breaks.

    Only clearly periodic frames count (Praat's strength of at least 0.8); the ends are
    the 2nd and 98th percentile, so single stray frames do not set them. A break is a
    jump of three semitones or more between clear frames at most 50 ms apart (a register
    flip, a yodel); jumps of about an octave are left out as octave errors of the
    tracker, and jumps within 0.25 s of a counted one belong to it.
    """
    mask = (pitch.values > 0) & (pitch.strength >= GLIDE_STRENGTH)
    clear, times = pitch.values[mask], pitch.times[mask]
    if len(clear) < MIN_VOICED_FRAMES:
        return {}
    low, high = (float(np.percentile(clear, p)) for p in (2, 98))
    breaks, last = 0, -np.inf
    for index in range(1, len(clear)):
        if times[index] - times[index - 1] > BREAK_GAP_S + 1e-9:
            continue
        jump = abs(semitones(float(clear[index]), float(clear[index - 1])))
        octave = OCTAVE_ERROR_ST[0] <= jump <= OCTAVE_ERROR_ST[1]
        if jump >= BREAK_ST and not octave and times[index] - last > BREAK_MERGE_S:
            breaks += 1
            last = times[index]
    return {
        "glide_low_hz": low,
        "glide_high_hz": high,
        "glide_range_st": semitones(high, low),
        "glide_breaks": float(breaks),
    }


def formant_fit(
    sound: parselmouth.Sound, groups: list[np.ndarray]
) -> tuple[list[list[float]], list[float]] | None:
    """Median F1 to F4 of groups of frames, with the analysis ceiling fitted to the voice.

    Burg's method finds five formants below a ceiling, so the ceiling has to sit where
    the voice has five: at five times its formant spacing. That ceiling is searched on a
    grid. Each run yields the groups' median formants and, from their mean, a spacing; the
    result is interpolated between the two neighbouring runs where "ceiling minus five
    spacings" changes sign. Runs with a median bandwidth above 500 Hz are discarded: a
    ceiling that is too low merges two formants into one wide one and then reads a short
    vocal tract as a long one.

    Args:
        sound: The audio to analyse.
        groups: Frame times, one array per group: all voiced frames of a take of speech,
            or the steady middle of each sustained vowel.

    Returns:
        The medians per group and their mean over the groups (four frequencies in Hz
        each), or `None` when no run finds all four formants in ten frames of every group.
    """
    runs: list[tuple[float, np.ndarray, float, float]] = []  # ceiling, medians, gap, width
    for ceiling in FORMANT_CEILINGS_HZ:
        formant = sound.to_formant_burg(
            time_step=TIME_STEP_S, max_number_of_formants=5, maximum_formant=ceiling
        )
        medians, widths = [], []
        for times in groups:
            rows = np.array(
                [
                    [formant.get_value_at_time(k, float(t)) for k in (1, 2, 3, 4)]
                    + [formant.get_bandwidth_at_time(k, float(t)) for k in (1, 2, 3, 4)]
                    for t in times
                ]
            )
            complete = rows[~np.isnan(rows).any(axis=1)] if len(rows) else rows
            if len(complete) < MIN_VOICED_FRAMES:
                break
            medians.append(np.median(complete[:, :4], axis=0))
            widths.append(np.median(complete[:, 4:], axis=0).max())
        if len(medians) < len(groups) or not medians:
            continue
        overall = [float(v) for v in np.mean(medians, axis=0)]
        gap = ceiling - CEILING_PER_SPACING * spacing(overall)[0]
        runs.append((ceiling, np.array(medians), gap, float(max(widths))))
    sound_runs = [run for run in runs if run[3] <= MAX_BANDWIDTH_HZ] or runs
    if not sound_runs:
        return None

    crossings = []
    for lower, upper in zip(sound_runs, sound_runs[1:], strict=False):
        adjacent = upper[0] - lower[0] <= CEILING_STEP_HZ
        if adjacent and lower[2] <= 0 <= upper[2] and lower[2] != upper[2]:
            weight = -lower[2] / (upper[2] - lower[2])
            crossings.append((max(lower[3], upper[3]), lower[1] + weight * (upper[1] - lower[1])))
    if crossings:
        medians = min(crossings, key=lambda crossing: crossing[0])[1]
    else:
        medians = min(sound_runs, key=lambda run: abs(run[2]) / run[0])[1]
    per_group = [[float(v) for v in row] for row in medians]
    return per_group, [float(v) for v in np.mean(medians, axis=0)]


def resonance_metrics(sound: parselmouth.Sound, pitch: PitchTrack, item: Item) -> dict[str, float]:
    """Median formants of the voiced, louder frames, their spacing and the tract length.

    Frames count when they are voiced and at least as loud as the take's 60th
    intensity percentile, which keeps vowels and drops most consonants.
    """
    intensity = sound.to_intensity(minimum_pitch=75.0, time_step=TIME_STEP_S)
    threshold = float(np.percentile(intensity.values[0], 60))
    times = np.array(
        [
            t
            for t, f in zip(pitch.times, pitch.values, strict=True)
            if f > 0 and (intensity.get_value(float(t)) or -np.inf) >= threshold
        ]
    )
    if len(times) < MIN_VOICED_FRAMES:
        return {}
    fit = formant_fit(sound, [times])
    if fit is None:
        return {}
    formants = fit[1]
    width, length = spacing(formants)
    out = {"formant_spacing_hz": width, "vtl_cm": length}
    if item != Item.VOWELS:
        out |= {f"f{i}_median_hz": value for i, value in enumerate(formants, start=1)}
    return out


def voiced_only(sound: parselmouth.Sound, pitch: PitchTrack) -> parselmouth.Sound | None:
    """The voiced stretches of a take, joined; `None` when there is less than 0.3 s."""
    values, times = pitch.values, pitch.times
    parts = []
    start = None
    for index, value in enumerate(values):
        if value > 0 and start is None:
            start = index
        if (value <= 0 or index == len(values) - 1) and start is not None:
            end = index if value <= 0 else index + 1
            if times[end - 1] - times[start] >= 0.05:
                parts.append(sound.extract_part(float(times[start]), float(times[end - 1])))
            start = None
    if not parts:
        return None
    joined = parselmouth.Sound.concatenate(parts)
    return joined if joined.duration >= 0.3 else None


def quality_metrics(voiced: parselmouth.Sound) -> dict[str, float]:
    """Voice quality of voiced audio: CPPS, HNR and the spectral slope.

    CPPS uses the settings of the Acoustic Voice Quality Index; the slope compares the
    energy below 1 kHz with the energy from 1 to 4 kHz.
    """
    harmonicity = voiced.to_harmonicity_cc(time_step=TIME_STEP_S, minimum_pitch=75.0)
    ratios = harmonicity.values[0]
    cepstrogram = call(voiced, "To PowerCepstrogram", 60, 0.002, 5000, 50)
    cpps = call(
        cepstrogram, "Get CPPS", False, 0.01, 0.001, 60, 330, 0.05, "Parabolic", 0.001, 0,
        "Straight", "Robust",
    )  # fmt: skip
    ltas = call(voiced, "To Ltas", 100)
    out = {
        "cpps_db": float(cpps),
        "spectral_slope_db": float(call(ltas, "Get slope", 0, 1000, 1000, 4000, "energy")),
    }
    audible = ratios[ratios > -100]
    if len(audible):
        out["hnr_db"] = float(np.median(audible))
    return {key: value for key, value in out.items() if np.isfinite(value)}


def vowel_segments(
    sound: parselmouth.Sound, pitch: PitchTrack, classify: bool = True
) -> tuple[list[VowelSegment], list[float] | None]:
    """The sustained vowels, or held sounds, of a take: voiced stretches of at least 1.5 s.

    Each is measured over its steady middle (the central 60%). One formant ceiling is
    fitted for the take, on the mean formants of its vowels. The vowel is guessed from
    the first two formants: a high F1 is "a", otherwise a high F2 is "i", otherwise "u".

    Args:
        sound: The take.
        pitch: Its pitch track.
        classify: Guess which vowel each is; off for held sounds that need not be a, i, u.

    Returns:
        The segments in order, and the mean of their formants (`None` without any).
    """
    values, times = pitch.values, pitch.times
    runs: list[tuple[int, int]] = []
    start = None
    for index, value in enumerate(values):
        if value > 0 and start is None:
            start = index
        if (value <= 0 or index == len(values) - 1) and start is not None:
            end = index if value <= 0 else index + 1
            # a dropout shorter than 0.15 s does not end a vowel
            if runs and times[start] - times[runs[-1][1] - 1] < 0.15:
                runs[-1] = (runs[-1][0], end)
            else:
                runs.append((start, end))
            start = None
    middles = []
    for first, last in runs:
        begin, finish = float(times[first]), float(times[last - 1])
        duration = finish - begin
        if duration >= MIN_VOWEL_S:
            middles.append((begin, duration, begin + 0.2 * duration, finish - 0.2 * duration))
    if not middles:
        return [], None
    fit = formant_fit(sound, [np.arange(a, b, TIME_STEP_S) for _, _, a, b in middles])
    if fit is None:
        return [], None
    segments = []
    for (begin, duration, a, b), formants in zip(middles, fit[0], strict=True):
        inside = values[(times >= a) & (times <= b)]
        inside = inside[inside > 0]
        quality = quality_metrics(sound.extract_part(a, b))
        vowel = None
        if classify:
            vowel = "a" if formants[0] > 550 else ("i" if formants[1] > 1700 else "u")
        segments.append(
            VowelSegment(
                start_s=begin,
                duration_s=duration,
                vowel=vowel,
                pitch_hz=float(np.median(inside)) if len(inside) else 0.0,
                formants_hz=formants,
                cpps_db=quality.get("cpps_db", 0.0),
                hnr_db=quality.get("hnr_db", 0.0),
            )
        )
    return segments, fit[1]


def analyse(path: Path, item: Item) -> Analysis:
    """Measure one take.

    Args:
        path: The recording (any format Praat reads; the API serves FLAC).
        item: What the take contains; it decides which measures apply.

    Returns:
        The metrics by registry key, the structured details, and the stored series.

    Raises:
        parselmouth.PraatError: The file cannot be read as audio.
    """
    sound = parselmouth.Sound(str(path))
    if sound.n_channels > 1:
        sound = sound.convert_to_mono()
    samples = sound.values[0]
    pitch = pitch_track(sound, item)
    result = Analysis(
        metrics={
            "duration_s": float(sound.duration),
            **level_metrics(samples, sound.sampling_frequency),
            **pitch_metrics(pitch, item),
        }
    )
    result.series["pitch_hz"] = Series(
        start_s=float(pitch.times[0]) if len(pitch.times) else 0.0,
        step_s=TIME_STEP_S,
        values=[round(float(v), 1) if v > 0 else None for v in pitch.values],
    )
    if len(pitch.voiced) < MIN_VOICED_FRAMES:
        return result

    if item == Item.GLIDE:
        result.metrics |= glide_metrics(pitch)
        return result

    if item in (Item.VOWELS, Item.SUSTAIN):
        segments, mean_formants = vowel_segments(sound, pitch, classify=item == Item.VOWELS)
        if item == Item.VOWELS:
            result.details.vowels = segments
        else:
            result.details.segments = segments
        if mean_formants is not None:
            # the tract length of a set of vowels: the spacing of their mean formants
            width, length = spacing(mean_formants)
            result.metrics |= {"formant_spacing_hz": width, "vtl_cm": length}
    else:
        result.metrics |= resonance_metrics(sound, pitch, item)

    voiced = voiced_only(sound, pitch)
    if voiced is not None:
        result.metrics |= quality_metrics(voiced)
    return result
