"""The API's request and response shapes, shared with the worker."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Schema(BaseModel):
    """Base of the API's models: in what the API returns, every field is present."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Intent(StrEnum):
    """Which voice a take was spoken in.

    `drill` is a sound made for an exercise (a slide, a hold, a hum), not a voice.
    """

    HABITUAL = "habitual"
    ATTEMPT = "attempt"
    DRILL = "drill"


class Item(StrEnum):
    """What a take contains."""

    VOWELS = "vowels"
    GLIDE = "glide"
    SUSTAIN = "sustain"
    PHRASE = "phrase"
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


class PersonIn(Schema):
    """Someone whose voice is recorded, to create or update.

    Attributes:
        name: Shown in lists; unique.
        note: Free text: who they are, why their voice is here.
    """

    name: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=2000)


class PersonOut(PersonIn):
    """A stored person.

    Attributes:
        id: The person.
        is_default: Whether this is the learner: the one person whose everyday voice
            every take is read against, and whose practice the app follows.
        created_at: When they were added.
        take_count: How many takes are theirs.
    """

    id: int
    is_default: bool
    created_at: datetime
    take_count: int


class Target(Schema):
    """What a practice take was recorded against.

    Attributes:
        band_low_hz: Lower edge of the learner's pitch band at the time.
        band_high_hz: Upper edge.
        note_hz: The note the app played for the take (note matching), `null` for none.
    """

    # NOTE: no defaults: the model travels both ways, and a default would make its request
    # and response schemas differ (two TypeScript types)
    band_low_hz: float = Field(ge=50, le=1000)
    band_high_hz: float = Field(ge=50, le=1000)
    note_hz: float | None = Field(ge=50, le=1000)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.band_low_hz >= self.band_high_hz:
            raise ValueError("the band's lower edge must lie below its upper edge")
        return self


class BandIn(Schema):
    """A pitch band to work in.

    Attributes:
        low_hz: Lower edge.
        high_hz: Upper edge; at least a semitone above the lower one.
    """

    low_hz: float = Field(ge=50, le=1000)
    high_hz: float = Field(ge=50, le=1000)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.high_hz < self.low_hz * 2 ** (1 / 12):
            raise ValueError("the band must span at least a semitone")
        return self


class BandOut(BandIn):
    """A stored band; the newest one is the current band."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class Feel(StrEnum):
    """How the voice feels at the start of a session."""

    FRESH = "fresh"
    NORMAL = "normal"
    TIRED = "tired"
    HOARSE = "hoarse"


class PracticeIn(Schema):
    """A practice session as the web app writes it (whole, idempotently).

    Attributes:
        routine_ref: The routine followed (`routine:starter@1`); unset for one exercise.
        language: Language of the session's spoken steps.
        started_at: When it started.
        ended_at: When it ended; unset while it runs or when it was abandoned.
        feel_start: How the voice felt at the start.
        comfort_end: How comfortable the session was overall, 1 (strained) to 5.
        lasting_tension: Whether tension lasted after stopping (a reason to rest).
        note: Free text.
    """

    routine_ref: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, min_length=2, max_length=8)
    started_at: datetime
    ended_at: datetime | None = None
    feel_start: Feel | None = None
    comfort_end: int | None = Field(default=None, ge=1, le=5)
    lasting_tension: bool | None = None
    note: str = Field(default="", max_length=2000)


class PracticeOut(PracticeIn):
    """A stored practice session with a summary of its takes.

    Attributes:
        id: The id the web app gave it.
        take_count: Takes recorded in it.
        last_take_at: When its last take was recorded.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    take_count: int
    last_take_at: datetime | None


class EvaluationProblem(StrEnum):
    """Why a take of an exercise could not be judged."""

    NOT_ANALYSED = "not-analysed"
    NO_BAND = "no-band"
    NO_NOTE = "no-note"
    TOO_LITTLE_VOICE = "too-little-voice"
    NOT_MEASURED = "not-measured"
    TOO_LITTLE_WHISPER = "too-little-whisper"
    UNKNOWN_EXERCISE = "unknown-exercise"


class Measure(Schema):
    """One number a judgement rests on, with what it was held against.

    Attributes:
        key: A measure (`band_share_pct`, `hold_s`, …) or a metric of the registry.
        value: The value.
        low: Lowest value that meets it; unset for no lower limit.
        high: Highest value that meets it; unset for no upper limit.
        met: Whether it is within limits; unset for a number given as context.
    """

    key: str
    value: float
    low: float | None = None
    high: float | None = None
    met: bool | None = None


class Advice(StrEnum):
    """What a judgement suggests trying next."""

    ABOVE_BAND = "above-band"
    BELOW_BAND = "below-band"
    ABOVE_NOTE = "above-note"
    BELOW_NOTE = "below-note"
    UNSTEADY = "unsteady"
    EFFORTFUL = "effortful"
    PITCH_MOVED = "pitch-moved"
    PITCH_TOO_HIGH = "pitch-too-high"
    NOT_BRIGHTER = "not-brighter"
    R1_UNREADABLE = "r1-unreadable"
    WHISPER_SAME = "whisper-same"
    RESONANCE_UNSTEADY = "resonance-unsteady"


class Evaluation(Schema):
    """How a take of an exercise went, by the exercise's rule. Computed, never stored.

    Attributes:
        exercise_ref: The exercise the take was recorded for.
        rule: The kind of rule (`pitch_hold`, …).
        met: Whether the take met the rule; unset when there is no rule or no judgement.
        measures: The one or two numbers the judgement rests on.
        hints: Registry metrics the exercise shows beside them, as hints.
        problem: Why there is no judgement.
        strained: The numbers met the rule but the rep was rated strained (comfort 1), so
            it is not met: comfort is a gate, a strained rep never counts.
        advice: What to try next: where the pitch sat against the band or the note, or
            that a met rep took effort.
    """

    exercise_ref: str
    rule: str
    met: bool | None = None
    measures: list[Measure] = []
    hints: list[Measure] = []
    problem: EvaluationProblem | None = None
    strained: bool = False
    advice: list[Advice] = []


class Zone(Schema):
    """A stretch of a measure's scale with a meaning, drawn on its strip.

    Attributes:
        key: Identifier (`typical`, `beyond`).
        low: Where it starts; unset for no lower end.
        high: Where it ends; unset for no upper end.
        titles: What it stands for, per language.
    """

    key: str
    low: float | None = None
    high: float | None = None
    titles: dict[str, str] = {}


class MeasureDef(Schema):
    """A measure of the evaluation or of a reading, with its texts.

    Attributes:
        key: Identifier used in `Measure.key` and `Shift.key`.
        unit: Unit of the value.
        decimals: Decimals worth showing.
        titles: Short name per language.
        descriptions: What it is, per language.
        zones: Stretches of its scale that carry a meaning (conventions, not limits).
    """

    key: str
    unit: str
    decimals: int
    titles: dict[str, str] = {}
    descriptions: dict[str, str] = {}
    zones: list[Zone] = []


class Basis(StrEnum):
    """Which everyday takes a take is read against: how alike they are to it."""

    SAME_TEXT = "same-text"
    SAME_KIND = "same-kind"
    SPEECH = "speech"
    VOWELS = "vowels"


class ReadingNote(StrEnum):
    """What a reading says in words: where the resonance sits, and what it cost."""

    EVERYDAY = "everyday"
    DARKER = "darker"
    BRIGHTER = "brighter"
    TYPICAL = "typical"
    BEYOND = "beyond"
    R1_UNREADABLE = "r1-unreadable"
    LIGHTER = "lighter"
    HEAVIER = "heavier"
    QUIETER = "quieter"
    LESS_CLEAR = "less-clear"


class Shift(Schema):
    """One number of a take against the learner's own everyday voice.

    Attributes:
        key: The measure (`pitch_shift_st`, `brightness_pct`, …).
        value: How far the take lies from the everyday voice.
        everyday: The everyday value the shift is counted from, in the unit of the metric
            behind it (Hz, dB); unset for a number made of several metrics.
        wobble: How far the everyday takes themselves scatter around their mean (their
            standard deviation, in the unit of `value`); unset with fewer than three.
    """

    key: str
    value: float
    everyday: float | None = None
    wobble: float | None = None


class Reading(Schema):
    """A take read against the learner's own everyday voice. Computed, never stored.

    Attributes:
        basis: Which everyday takes it was read against.
        takes: How many of them.
        shifts: The numbers: pitch, then resonance, then what it cost.
        notes: The same in words.
    """

    basis: Basis
    takes: int
    shifts: list[Shift]
    notes: list[ReadingNote] = []


class Reference(Schema):
    """The learner's everyday voice for one kind of take on one microphone setup.

    Attributes:
        basis: How alike its takes are to the kind asked for.
        take_ids: The everyday takes it is made of, oldest first.
        pitch_hz: Their median pitch (geometric mean over the takes); unset if unmeasured.
        formants_hz: F1 to F4 of speech (geometric mean over the takes); empty for vowels.
        vowels: F1 to F4 per sustained vowel (`a`, `i`, `u`); empty for speech.
    """

    basis: Basis
    take_ids: list[str]
    pitch_hz: float | None
    formants_hz: list[float]
    vowels: dict[str, list[float]]


class TakeMeta(Schema):
    """The labels of a take being uploaded.

    Attributes:
        device_id: The microphone setup it was recorded with.
        person_id: Whose voice it is; the default person's when unset.
        item: What was spoken.
        intent: Which voice it was.
        language: Language spoken (`en`, `cs`, …); unset for vowels and glides.
        content_ref: The text that was read, with its version (`passage:garden-en@1`).
        recorded_at: When it was recorded; defaults to the upload time.
        note: Free text.
        client_id: The uploader's own id for this take. Uploading again with the same id
            returns the take stored the first time, so a retry never duplicates it.
        session_id: The practice session it belongs to (written before its takes).
        exercise_ref: The exercise it is a rep of (`exercise:note-match@1`).
        target: The band, and the note played, it was recorded against.
        comfort: How comfortable it was, 1 (strained) to 5 (effortless).
    """

    device_id: int
    person_id: int | None = None
    item: Item
    intent: Intent
    language: str | None = Field(default=None, min_length=2, max_length=8)
    content_ref: str | None = Field(default=None, max_length=120)
    recorded_at: datetime | None = None
    note: str = Field(default="", max_length=2000)
    client_id: str | None = Field(default=None, min_length=8, max_length=64)
    session_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,64}$")
    exercise_ref: str | None = Field(default=None, max_length=120)
    target: Target | None = None
    comfort: int | None = Field(default=None, ge=1, le=5)


class TakePatch(Schema):
    """Labels of a take to change; unset fields stay as they are."""

    device_id: int | None = None
    person_id: int | None = None
    item: Item | None = None
    intent: Intent | None = None
    language: str | None = Field(default=None, min_length=2, max_length=8)
    content_ref: str | None = Field(default=None, max_length=120)
    recorded_at: datetime | None = None
    note: str | None = Field(default=None, max_length=2000)
    comfort: int | None = Field(default=None, ge=1, le=5)


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
    """One sustained vowel, or held sound, found in a take.

    Attributes:
        start_s: Where it starts.
        duration_s: How long it is held.
        vowel: Which vowel it most likely is (`a`, `i` or `u`), from its formants; unset
            for the held sounds of a `sustain` take, which need not be those vowels.
        pitch_hz: Median pitch.
        formants_hz: F1 to F4 over the steady middle; empty when the sound is pitched too
            high for formants to be measured (above 300 Hz).
        cpps_db: Smoothed cepstral peak prominence of the steady middle.
        hnr_db: Harmonics-to-noise ratio of the steady middle.
        h1h2_db: How far the fundamental stands above the second harmonic over the steady
            middle (lightness); unset when it was not measured (an older analysis).
        r1_unreadable_pct: The share of the steady middle's frames whose F1 cannot be told
            from the pitch (see the metric of the same name); unset when not measured.
        formant_spread_pct: How far the upper formants scatter from frame to frame over
            the steady middle (90th over 10th percentile of their geometric mean); a held
            sound stays within a few percent, and a larger value means the analysis found
            no steady reading. Unset when not measured.
    """

    start_s: float
    duration_s: float
    vowel: str | None = None
    pitch_hz: float
    formants_hz: list[float]
    cpps_db: float
    hnr_db: float
    h1h2_db: float | None = None
    r1_unreadable_pct: float | None = None
    formant_spread_pct: float | None = None


class WhisperSpan(Schema):
    """A stretch of a take that sounds without a voice: a whisper.

    Attributes:
        start_s: Where it starts.
        duration_s: How long it is (a second; the whisper inside comes in puffs).
        formants_hz: F1 to F4, the median over its sounding frames.
    """

    start_s: float
    duration_s: float
    formants_hz: list[float]


class TraceZero(StrEnum):
    """What the resonance rows of a trace are counted from."""

    FIRST_SOUND = "first-sound"
    FIRST_WHISPER = "first-whisper"


class TraceRow(Schema):
    """One measure of a take over time.

    Attributes:
        key: `pitch_hz`, `brightness_pct`, `r1_pct`, `lightness_db`, `clarity_db` or
            `level_db`.
        values: One value per step of the trace; `None` where there is nothing to read.
    """

    key: str
    values: list[float | None]


class TraceSpan(Schema):
    """A stretch of a take that is one thing: a held sound, or a run of whispered seconds.

    Attributes:
        start_s: Where it starts.
        end_s: Where it ends.
        kind: `held` or `whisper`.
    """

    start_s: float
    end_s: float
    kind: Literal["held", "whisper"]


class Trace(Schema):
    """A take moment by moment, ready to draw. Computed from its stored series, never stored.

    Attributes:
        start_s: Time of the first step.
        step_s: Time between steps.
        rows: The measures, in the order they are drawn.
        r1_unreadable: Per step, whether the first resonance cannot be read there (the
            voice is so light that the analysis finds the pitch); `r1_pct` is `None` there.
        zero: What `brightness_pct` and `r1_pct` are counted from; unset without them.
        spans: The held sounds and whispered stretches of the take, in order.
    """

    start_s: float
    step_s: float
    rows: list[TraceRow]
    r1_unreadable: list[bool]
    zero: TraceZero | None
    spans: list[TraceSpan]


class Details(Schema):
    """What an analysis found besides single numbers.

    Attributes:
        vowels: The sustained vowels of a `vowels` take, in order.
        segments: The held sounds of a `sustain` take, in order.
        whisper: The whispered seconds of a `sustain` take, in order; empty unless the
            take is a whisper for a good part.
    """

    vowels: list[VowelSegment] = []
    segments: list[VowelSegment] = []
    whisper: list[WhisperSpan] = []


class TakeOut(Schema):
    """A stored take with its labels, its analysis state and its metrics.

    `metrics`, `details` and `series` come from the newest finished analysis; the
    `evaluation` of a practice take and the `reading` of a voice against the everyday
    takes of the default person (whoever's voice the take is) are computed from them
    when the take is read.
    """

    id: str
    created_at: datetime
    recorded_at: datetime
    device_id: int
    device_name: str
    person_id: int
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
    client_id: str | None
    session_id: str | None
    exercise_ref: str | None
    target: Target | None
    comfort: int | None
    evaluation: Evaluation | None
    reading: Reading | None


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
        relates: What it says about pitch or resonance, the two targets, per language.
    """

    key: str
    unit: str
    decimals: int
    group: MetricGroup
    items: list[Item] | None = None
    titles: dict[str, str] = {}
    descriptions: dict[str, str] = {}
    notes: dict[str, str] = {}
    relates: dict[str, str] = {}


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


class Skill(StrEnum):
    """What an exercise trains, on the curriculum's spine."""

    WARM_UP = "warm-up"
    PITCH_WEIGHT = "pitch-weight"
    RESONANCE = "resonance"
    CLARITY = "clarity"
    CARRY_OVER = "carry-over"


class Live(StrEnum):
    """What the recording screen shows while an exercise is recorded."""

    NONE = "none"
    PITCH = "pitch"
    FORMANTS = "formants"
    WHISPER = "whisper"


class Demo(StrEnum):
    """The pitch pattern of an exercise the app can play as a tone, to show its shape."""

    NONE = "none"
    SLIDE_DOWN = "slide-down"
    GLIDE = "glide"
    HOLD = "hold"


class SkillDef(Schema):
    """A skill as the app explains it.

    Attributes:
        key: The skill.
        titles: Short name per language.
        descriptions: What it is, in plain words, per language.
        aliases: Other names for it in the teachers' material (mostly English terms).
    """

    key: Skill
    titles: dict[str, str]
    descriptions: dict[str, str]
    aliases: list[str] = []


class Source(Schema):
    """Where an exercise or a routine comes from.

    Attributes:
        author: The teacher or resource.
        title: The page, video or document.
        url: A link to it.
    """

    author: str = Field(min_length=1)
    title: str = Field(min_length=1)
    url: str = Field(pattern=r"^https://")


class NoRule(Schema):
    """Takes are not judged; the exercise shows its hints only."""

    kind: Literal["none"]


class PitchBandRule(Schema):
    """Speech judged by how much of its voiced time lies inside the target band.

    Attributes:
        min_share_pct: The share that counts as met.
        above_ok: Count time above the band as well: for sounds meant to be light and
            high, where only falling below the band misses the point.
    """

    kind: Literal["pitch_band"]
    min_share_pct: float = Field(gt=0, le=100)
    above_ok: bool = False


class PitchHoldRule(Schema):
    """A held note judged by how long it stays steady inside the band, or on a note.

    The hold is the longest stretch whose pitch stays inside the band (or within
    `tolerance_cents` of the note) and within a window of `spread_cents` either side of
    its middle; dropouts up to 50 ms do not end it.

    Attributes:
        at: Inside the target band, or on the note the app played.
        min_hold_s: The hold that counts as met.
        tolerance_cents: How far from the note the pitch may be (`at = "note"`).
        spread_cents: How far the held pitch may wander either side of its middle.
    """

    kind: Literal["pitch_hold"]
    at: Literal["band", "note"]
    min_hold_s: float = Field(gt=0, le=30)
    tolerance_cents: float = Field(default=50, gt=0, le=200)
    spread_cents: float = Field(default=50, gt=0, le=200)


class MetricRule(Schema):
    """A take judged by one metric of the registry against a fixed limit.

    Attributes:
        key: The metric.
        below: Met when the value is at most this.
        above: Met when the value is at least this.
    """

    kind: Literal["metric"]
    key: str
    below: float | None = None
    above: float | None = None

    @model_validator(mode="after")
    def _one_limit(self) -> Self:
        if (self.below is None) == (self.above is None):
            raise ValueError("a metric rule takes exactly one of `below` and `above`")
        return self


class StepsRule(Schema):
    """Held sounds read against the first of them, while the pitch stays put.

    The first sound is the learner's ordinary one; the last is the one the exercise is
    after. Met when the take has `count` held sounds, the last is brighter than the first
    (F2 to F4 higher by `min_bright_pct`), and all their pitches lie within
    `max_drift_st`.

    Attributes:
        count: Held sounds expected.
        max_drift_st: How far apart their pitches may be, in semitones.
        min_bright_pct: How much brighter than the first the last has to measure: above
            what two takes of the same sound differ by.
    """

    kind: Literal["steps"]
    count: int = Field(ge=2, le=6)
    max_drift_st: float = Field(gt=0, le=12)
    min_bright_pct: float = Field(default=3.0, ge=0, le=50)


class WhisperRule(Schema):
    """A whispered slide read against its own start: did the resonances move.

    The first `lead` whispered seconds are the big position. Of the seconds after them,
    the three with the highest first resonance and the three with the highest upper
    resonances are each summed up by their median. Met when both lie above the big
    position by the given amounts: bars for "it moved", not for how far.

    Attributes:
        lead: Whispered seconds at the start that make the big position.
        min_r1_pct: How much higher F1 has to sit.
        min_bright_pct: How much higher F2 to F4 have to sit.
    """

    kind: Literal["whisper"]
    lead: int = Field(default=3, ge=1, le=10)
    min_r1_pct: float = Field(default=8.0, ge=0, le=100)
    min_bright_pct: float = Field(default=5.0, ge=0, le=100)


Rule = Annotated[
    NoRule | PitchBandRule | PitchHoldRule | MetricRule | StepsRule | WhisperRule,
    Field(discriminator="kind"),
]


class SequencePart(Schema):
    """One part of what a take of an exercise contains, for the picture of its order.

    Attributes:
        labels: What to do, in a few words, per language; unset for a pause.
        seconds: How long it lasts, where that matters.
        pause: A silence between two sounds.
    """

    labels: dict[str, str] = {}
    seconds: float | None = Field(default=None, gt=0, le=60)
    pause: bool = False


class Exercise(Schema):
    """A drill, as data: what to do and why, how a take of it is judged, its sources.

    Attributes:
        id: Identifier; takes refer to `exercise:<id>@<version>`.
        version: Raised when what the learner is asked to do changes.
        skill: What it trains.
        item: The kind of take a rep is; it decides what the pipeline measures.
        intent: `drill` for a sound made for the exercise, `attempt` for speech in the
            voice being trained.
        seconds: Rough length of one rep.
        reps: How many reps a session asks for, unless a routine says otherwise.
        live: What the recording screen shows while recording.
        demo: The pitch pattern the app can play as a tone before recording.
        texts: The text to read, by language, as a passage reference.
        hints: Registry metrics shown beside the result, labelled as hints.
        titles: Short name per language.
        summaries: One line per language.
        steps: What to do, step by step, per language.
        sequence: The parts of one take in order, for a small picture of it; empty for
            an exercise that is one thing from start to end.
        right: What it sounds and feels like when it goes right, per language.
        mistakes: Common mistakes and what to do about each, per language.
        why: What it is for, per language.
        safety: When to stop or back off, per language.
        rule: How a take is judged.
        sources: Where it comes from; the instructions paraphrase these.
    """

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    version: int = Field(ge=1)
    skill: Skill
    item: Item
    intent: Intent
    seconds: int = Field(ge=1, le=600)
    reps: int = Field(ge=1, le=20)
    live: Live = Live.NONE
    demo: Demo = Demo.NONE
    texts: dict[str, str] = {}
    hints: list[str] = []
    titles: dict[str, str]
    summaries: dict[str, str]
    steps: dict[str, list[str]]
    sequence: list[SequencePart] = []
    right: dict[str, str]
    mistakes: dict[str, list[str]] = {}
    why: dict[str, str]
    safety: dict[str, str] = {}
    rule: Rule
    sources: list[Source] = Field(min_length=1)


class RoutineStep(Schema):
    """One step of a routine.

    Attributes:
        exercise: The exercise's id.
        reps: Reps for this step; unset for the exercise's own number.
    """

    exercise: str
    reps: int | None = Field(default=None, ge=1, le=20)


class Routine(Schema):
    """A guided session: exercises in order.

    Attributes:
        id: Identifier; sessions refer to `routine:<id>@<version>`.
        version: Raised when the steps change.
        minutes: Rough length.
        titles: Short name per language.
        summaries: One line per language.
        steps: The exercises in order.
        sources: Where the shape of the routine comes from.
    """

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    version: int = Field(ge=1)
    minutes: int = Field(ge=1, le=120)
    titles: dict[str, str]
    summaries: dict[str, str]
    steps: list[RoutineStep] = Field(min_length=1)
    sources: list[Source] = []


class Content(Schema):
    """Everything under `content/` the web app needs."""

    passages: list[Passage]
    protocols: list[Protocol]
    skills: list[SkillDef] = []
    exercises: list[Exercise] = []
    routines: list[Routine] = []


class Login(Schema):
    """What the web app sends to sign in."""

    token: str = Field(min_length=1, max_length=512)


class SessionOut(Schema):
    """Whether this API asks for a token, and whether the caller has given it.

    Attributes:
        login_required: The API has an access token configured.
        signed_in: The request carried the token (or none is required).
    """

    login_required: bool
    signed_in: bool


class ErrorOut(Schema):
    """Every error response."""

    error: str
