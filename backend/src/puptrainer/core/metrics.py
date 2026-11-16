"""The metric registry: every number the pipeline may store for a take.

Titles, descriptions and reliability notes live in `content/metrics/<language>.toml`.
"""

from puptrainer.core.schemas import Item, MetricDef, MetricGroup

SPEECH = [Item.PASSAGE, Item.FREE, Item.OTHER]
VOICED = [Item.VOWELS, Item.PASSAGE, Item.FREE, Item.OTHER]


def _m(
    key: str, unit: str, decimals: int, group: MetricGroup, items: list[Item] | None = None
) -> MetricDef:
    return MetricDef(key=key, unit=unit, decimals=decimals, group=group, items=items)


REGISTRY: tuple[MetricDef, ...] = (
    # --- recording quality
    _m("duration_s", "s", 1, MetricGroup.RECORDING),
    _m("peak_dbfs", "dBFS", 1, MetricGroup.RECORDING),
    _m("speech_level_dbfs", "dBFS", 1, MetricGroup.RECORDING),
    _m("noise_floor_dbfs", "dBFS", 1, MetricGroup.RECORDING),
    _m("clipped_samples", "", 0, MetricGroup.RECORDING),
    _m("voiced_share_pct", "%", 0, MetricGroup.RECORDING),
    # --- pitch
    _m("pitch_median_hz", "Hz", 0, MetricGroup.PITCH, VOICED),
    _m("pitch_p05_hz", "Hz", 0, MetricGroup.PITCH, SPEECH),
    _m("pitch_p95_hz", "Hz", 0, MetricGroup.PITCH, SPEECH),
    _m("pitch_range_st", "st", 1, MetricGroup.PITCH, SPEECH),
    _m("pitch_sd_st", "st", 1, MetricGroup.PITCH, SPEECH),
    _m("pitch_below_145_pct", "%", 0, MetricGroup.PITCH, SPEECH),
    _m("pitch_145_185_pct", "%", 0, MetricGroup.PITCH, SPEECH),
    _m("pitch_above_185_pct", "%", 0, MetricGroup.PITCH, SPEECH),
    _m("subharmonic_share_pct", "%", 0, MetricGroup.PITCH, VOICED),
    # --- resonance
    _m("f1_median_hz", "Hz", 0, MetricGroup.RESONANCE, SPEECH),
    _m("f2_median_hz", "Hz", 0, MetricGroup.RESONANCE, SPEECH),
    _m("f3_median_hz", "Hz", 0, MetricGroup.RESONANCE, SPEECH),
    _m("f4_median_hz", "Hz", 0, MetricGroup.RESONANCE, SPEECH),
    _m("formant_spacing_hz", "Hz", 0, MetricGroup.RESONANCE, VOICED),
    _m("vtl_cm", "cm", 1, MetricGroup.RESONANCE, VOICED),
    # --- voice quality
    _m("cpps_db", "dB", 1, MetricGroup.QUALITY, VOICED),
    _m("hnr_db", "dB", 1, MetricGroup.QUALITY, VOICED),
    _m("spectral_slope_db", "dB", 1, MetricGroup.QUALITY, VOICED),
    # --- range
    _m("glide_low_hz", "Hz", 0, MetricGroup.RANGE, [Item.GLIDE]),
    _m("glide_high_hz", "Hz", 0, MetricGroup.RANGE, [Item.GLIDE]),
    _m("glide_range_st", "st", 1, MetricGroup.RANGE, [Item.GLIDE]),
)

KEYS: frozenset[str] = frozenset(m.key for m in REGISTRY)
