"""The API's request and response shapes, shared with the worker."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Schema(BaseModel):
    """Base of the API's models: in what the API returns, every field is present."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Intent(StrEnum):
    """Which voice a take was spoken in."""

    HABITUAL = "habitual"
    ATTEMPT = "attempt"


class Item(StrEnum):
    """What a take contains."""

    VOWELS = "vowels"
    GLIDE = "glide"
    PASSAGE = "passage"
    FREE = "free"
    OTHER = "other"


class DeviceKind(StrEnum):
    """Kind of microphone."""

    LAVALIER = "lavalier"
    HEADSET = "headset"
    DESKTOP = "desktop"
    LAPTOP = "laptop"
    PHONE = "phone"
    OTHER = "other"


class MetricGroup(StrEnum):
    """What a metric is about."""

    RECORDING = "recording"
    PITCH = "pitch"
    RESONANCE = "resonance"
    QUALITY = "quality"
    RANGE = "range"


class JobStatus(StrEnum):
    """State of an analysis job."""

    PENDING = "pending"
    CLAIMED = "claimed"
    DONE = "done"
    FAILED = "failed"


class DeviceIn(Schema):
    """A microphone setup to create or update.

    Attributes:
        name: Shown in lists; unique.
        kind: Kind of microphone.
        note: The setup: where the microphone sits, gain, room.
    """

    name: str = Field(min_length=1, max_length=80)
    kind: DeviceKind = DeviceKind.OTHER
    note: str = Field(default="", max_length=2000)


class DeviceOut(DeviceIn):
    """A stored microphone setup."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class TakeMeta(Schema):
    """The labels of a take being uploaded.

    Attributes:
        device_id: The microphone setup it was recorded with.
        item: What was spoken.
        intent: Which voice it was.
        language: Language spoken (`en`, `cs`, …); unset for vowels and glides.
        content_ref: The text that was read, with its version (`passage:garden-en@1`).
        recorded_at: When it was recorded; defaults to the upload time.
        note: Free text.
        client_id: The uploader's own id for this take. Uploading again with the same id
            returns the take stored the first time, so a retry never duplicates it.
    """

    device_id: int
    item: Item
    intent: Intent
    language: str | None = Field(default=None, min_length=2, max_length=8)
    content_ref: str | None = Field(default=None, max_length=120)
    recorded_at: datetime | None = None
    note: str = Field(default="", max_length=2000)
    client_id: str | None = Field(default=None, min_length=8, max_length=64)


class TakePatch(Schema):
    """Labels of a take to change; unset fields stay as they are."""

    device_id: int | None = None
    item: Item | None = None
    intent: Intent | None = None
    language: str | None = Field(default=None, min_length=2, max_length=8)
    content_ref: str | None = Field(default=None, max_length=120)
    recorded_at: datetime | None = None
    note: str | None = Field(default=None, max_length=2000)


class AnalysisOut(Schema):
    """The latest analysis job of a take.

    Attributes:
        status: Where the job stands.
        pipeline_version: Version of the pipeline that ran it; unset until it finishes.
        error: Why it failed.
        finished_at: When it finished.
    """

    status: JobStatus
    pipeline_version: str | None = None
    error: str | None = None
    finished_at: datetime | None = None


class Series(Schema):
    """Evenly spaced values over a take, e.g. its pitch contour.

    Attributes:
        start_s: Time of the first value.
        step_s: Time between values.
        values: One value per step; `None` where there is nothing to measure (unvoiced).
    """

    start_s: float
    step_s: float
    values: list[float | None]


class VowelSegment(Schema):
    """One sustained vowel found in a take.

    Attributes:
        start_s: Where it starts.
        duration_s: How long it is held.
        vowel: Which vowel it most likely is (`a`, `i` or `u`), from its formants.
        pitch_hz: Median pitch.
        formants_hz: F1 to F4 over the steady middle.
        cpps_db: Smoothed cepstral peak prominence of the steady middle.
        hnr_db: Harmonics-to-noise ratio of the steady middle.
    """

    start_s: float
    duration_s: float
    vowel: str
    pitch_hz: float
    formants_hz: list[float]
    cpps_db: float
    hnr_db: float


class Details(Schema):
    """What an analysis found besides single numbers.

    Attributes:
        vowels: The sustained vowels of a `vowels` take, in order.
    """

    vowels: list[VowelSegment] = []


class TakeOut(Schema):
    """A stored take with its labels, its analysis state and its metrics.

    `metrics`, `details` and `series` come from the newest finished analysis.
    """

    id: str
    created_at: datetime
    recorded_at: datetime
    device_id: int
    device_name: str
    item: Item
    intent: Intent
    language: str | None
    content_ref: str | None
    note: str
    original_name: str
    sha256: str
    sample_rate: int
    channels: int
    duration_s: float
    analysis: AnalysisOut | None
    metrics: dict[str, float]
    details: Details
    series: list[str]


class JobClaim(Schema):
    """A job handed to the worker.

    Attributes:
        job_id: The job.
        take_id: The take to analyse.
        item: What the take contains (some measures depend on it).
        audio_path: API path of the recording, relative to the API root.
    """

    job_id: int
    take_id: str
    item: Item
    audio_path: str


class WorkerHello(Schema):
    """What the worker says about itself when it asks for work."""

    pipeline_version: str


class JobResult(Schema):
    """What the worker reports for a finished job.

    Attributes:
        pipeline_version: Version of the pipeline that ran.
        metrics: Values by registry key.
        details: Structured findings.
        series: Stored series by key (`pitch_hz`).
    """

    pipeline_version: str
    metrics: dict[str, float]
    details: Details = Details()
    series: dict[str, Series] = {}


class Requeued(Schema):
    """Answer to a request to analyse takes again."""

    queued: int


class JobFailure(Schema):
    """What the worker reports for a failed job."""

    pipeline_version: str
    error: str = Field(max_length=4000)


class Health(Schema):
    """Liveness and queue state.

    Attributes:
        status: Always `ok` when the API answers.
        version: Version of the backend.
        pending_jobs: Jobs waiting for or held by the worker.
        worker_seen_s: Seconds since the worker last asked for work; unset if never.
        pipeline_version: The pipeline version the worker last reported; unset if never.
    """

    status: str
    version: str
    pending_jobs: int
    worker_seen_s: float | None
    pipeline_version: str | None


class MetricDef(Schema):
    """One metric of the registry.

    Attributes:
        key: Identifier used in `TakeOut.metrics`.
        unit: Unit of the value (`Hz`, `dBFS`, `st` for semitones, …), empty for counts.
        decimals: Decimals worth showing.
        group: What it is about.
        items: The kinds of take it is measured on; unset for all.
        titles: Short name per language.
        descriptions: What it measures, per language.
        notes: How far to trust it and how to read it, per language.
    """

    key: str
    unit: str
    decimals: int
    group: MetricGroup
    items: list[Item] | None = None
    titles: dict[str, str] = {}
    descriptions: dict[str, str] = {}
    notes: dict[str, str] = {}


class Passage(Schema):
    """A reading passage. Its text is frozen once takes exist for a version."""

    id: str
    language: str
    version: int
    title: str
    text: str


class ProtocolItem(Schema):
    """One step of a recording protocol.

    Attributes:
        key: Identifier within the protocol.
        item: What the take contains.
        language: Language spoken, when the step has one.
        content_ref: The passage to read, when the step has one.
        titles: Short name per language.
        instructions: What to do, per language.
        seconds: Rough length of the take.
    """

    key: str
    item: Item
    language: str | None = None
    content_ref: str | None = None
    titles: dict[str, str]
    instructions: dict[str, str]
    seconds: int


class Protocol(Schema):
    """A fixed sequence of takes, e.g. the baseline."""

    id: str
    titles: dict[str, str]
    items: list[ProtocolItem]


class Content(Schema):
    """Everything under `content/` the web app needs."""

    passages: list[Passage]
    protocols: list[Protocol]


class ErrorOut(Schema):
    """Every error response."""

    error: str
