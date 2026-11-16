"""The metric registry: every number the pipeline may store for a take."""

from puptrainer.core.schemas import MetricDef

REGISTRY: tuple[MetricDef, ...] = (
    MetricDef(key="duration_s", unit="s", decimals=1),
    MetricDef(key="peak_dbfs", unit="dBFS", decimals=1),
    MetricDef(key="speech_level_dbfs", unit="dBFS", decimals=1),
    MetricDef(key="noise_floor_dbfs", unit="dBFS", decimals=1),
    MetricDef(key="clipped_samples", unit="", decimals=0),
    MetricDef(key="voiced_fraction", unit="", decimals=2),
    MetricDef(key="pitch_median_hz", unit="Hz", decimals=0),
)

KEYS: frozenset[str] = frozenset(m.key for m in REGISTRY)
