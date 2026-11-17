// Generated from the API's models by `python -m puptrainer.api.tstypes`.
// Do not edit: change the models in backend/src/puptrainer/core/schemas.py and regenerate.

/** The latest analysis job of a take. */
export type AnalysisOut = {
	status: JobStatus;
	pipeline_version: string | null;
	error: string | null;
	finished_at: string | null;
};

/** A pitch band to work in. */
export type BandIn = {
	low_hz: number;
	high_hz: number;
};

/** A stored band; the newest one is the current band. */
export type BandOut = {
	low_hz: number;
	high_hz: number;
	id: number;
	created_at: string;
};

/** Everything under `content/` the web app needs. */
export type Content = {
	passages: Passage[];
	protocols: Protocol[];
	skills: SkillDef[];
	exercises: Exercise[];
	routines: Routine[];
};

/** What an analysis found besides single numbers. */
export type Details = {
	vowels: VowelSegment[];
	segments: VowelSegment[];
};

/** A microphone setup to create or update. */
export type DeviceIn = {
	name: string;
	kind?: DeviceKind;
	note?: string;
};

/** Kind of microphone. */
export type DeviceKind = 'lavalier' | 'headset' | 'desktop' | 'laptop' | 'phone' | 'other';

/** A stored microphone setup. */
export type DeviceOut = {
	name: string;
	kind: DeviceKind;
	note: string;
	id: number;
	created_at: string;
};

/** Every error response. */
export type ErrorOut = {
	error: string;
};

/** How a take of an exercise went, by the exercise's rule. Computed, never stored. */
export type Evaluation = {
	exercise_ref: string;
	rule: string;
	met: boolean | null;
	measures: Measure[];
	hints: Measure[];
	problem: EvaluationProblem | null;
	strained: boolean;
};

/** Why a take of an exercise could not be judged. */
export type EvaluationProblem = 'not-analysed' | 'no-band' | 'no-note' | 'too-little-voice' | 'not-measured' | 'unknown-exercise';

/** A drill, as data: what to do and why, how a take of it is judged, its sources. */
export type Exercise = {
	id: string;
	version: number;
	skill: Skill;
	item: Item;
	intent: Intent;
	seconds: number;
	reps: number;
	live: Live;
	texts: Record<string, string>;
	hints: string[];
	titles: Record<string, string>;
	summaries: Record<string, string>;
	instructions: Record<string, string>;
	why: Record<string, string>;
	safety: Record<string, string>;
	rule: NoRule | PitchBandRule | PitchHoldRule | MetricRule | StepsRule;
	sources: Source[];
};

/** How the voice feels at the start of a session. */
export type Feel = 'fresh' | 'normal' | 'tired' | 'hoarse';

/** Liveness and queue state. */
export type Health = {
	status: string;
	version: string;
	pending_jobs: number;
	worker_seen_s: number | null;
	pipeline_version: string | null;
};

/** Which voice a take was spoken in. */
export type Intent = 'habitual' | 'attempt' | 'drill';

/** What a take contains. */
export type Item = 'vowels' | 'glide' | 'sustain' | 'phrase' | 'passage' | 'free' | 'other';

/** State of an analysis job. */
export type JobStatus = 'pending' | 'claimed' | 'done' | 'failed';

/** What the recording screen shows while an exercise is recorded. */
export type Live = 'none' | 'pitch';

/** What the web app sends to sign in. */
export type Login = {
	token: string;
};

/** One number a judgement rests on, with what it was held against. */
export type Measure = {
	key: string;
	value: number;
	low: number | null;
	high: number | null;
	met: boolean | null;
};

/** A measure of the evaluation, with its texts. */
export type MeasureDef = {
	key: string;
	unit: string;
	decimals: number;
	titles: Record<string, string>;
	descriptions: Record<string, string>;
};

/** One metric of the registry. */
export type MetricDef = {
	key: string;
	unit: string;
	decimals: number;
	group: MetricGroup;
	items: Item[] | null;
	titles: Record<string, string>;
	descriptions: Record<string, string>;
	notes: Record<string, string>;
};

/** What a metric is about. */
export type MetricGroup = 'recording' | 'pitch' | 'resonance' | 'quality' | 'range';

/** A take judged by one metric of the registry against a fixed limit. */
export type MetricRule = {
	kind: 'metric';
	key: string;
	below: number | null;
	above: number | null;
};

/** Takes are not judged; the exercise shows its hints only. */
export type NoRule = {
	kind: 'none';
};

/** A reading passage. Its text is frozen once takes exist for a version. */
export type Passage = {
	id: string;
	language: string;
	version: number;
	title: string;
	text: string;
};

/** Speech judged by how much of its voiced time lies inside the target band. */
export type PitchBandRule = {
	kind: 'pitch_band';
	min_share_pct: number;
};

/** A held note judged by how long it stays steady inside the band, or on a note. */
export type PitchHoldRule = {
	kind: 'pitch_hold';
	at: 'band' | 'note';
	min_hold_s: number;
	tolerance_cents: number;
	spread_cents: number;
};

/** A practice session as the web app writes it (whole, idempotently). */
export type PracticeIn = {
	routine_ref?: string | null;
	language?: string | null;
	started_at: string;
	ended_at?: string | null;
	feel_start?: Feel | null;
	comfort_end?: number | null;
	lasting_tension?: boolean | null;
	note?: string;
};

/** A stored practice session with a summary of its takes. */
export type PracticeOut = {
	routine_ref: string | null;
	language: string | null;
	started_at: string;
	ended_at: string | null;
	feel_start: Feel | null;
	comfort_end: number | null;
	lasting_tension: boolean | null;
	note: string;
	id: string;
	take_count: number;
	last_take_at: string | null;
};

/** A fixed sequence of takes, e.g. the baseline. */
export type Protocol = {
	id: string;
	titles: Record<string, string>;
	items: ProtocolItem[];
};

/** One step of a recording protocol. */
export type ProtocolItem = {
	key: string;
	item: Item;
	language: string | null;
	content_ref: string | null;
	titles: Record<string, string>;
	instructions: Record<string, string>;
	seconds: number;
};

/** Answer to a request to analyse takes again. */
export type Requeued = {
	queued: number;
};

/** A guided session: exercises in order. */
export type Routine = {
	id: string;
	version: number;
	minutes: number;
	titles: Record<string, string>;
	summaries: Record<string, string>;
	steps: RoutineStep[];
	sources: Source[];
};

/** One step of a routine. */
export type RoutineStep = {
	exercise: string;
	reps: number | null;
};

/** Evenly spaced values over a take, e.g. its pitch contour. */
export type Series = {
	start_s: number;
	step_s: number;
	values: (number | null)[];
};

/** Whether this API asks for a token, and whether the caller has given it. */
export type SessionOut = {
	login_required: boolean;
	signed_in: boolean;
};

/** What an exercise trains, on the curriculum's spine. */
export type Skill = 'warm-up' | 'pitch-weight' | 'size' | 'clarity' | 'carry-over';

/** A skill as the app explains it. */
export type SkillDef = {
	key: Skill;
	titles: Record<string, string>;
	descriptions: Record<string, string>;
	aliases: string[];
};

/** Where an exercise or a routine comes from. */
export type Source = {
	author: string;
	title: string;
	url: string;
};

/** Held sounds that should change step by step while the pitch stays put. */
export type StepsRule = {
	kind: 'steps';
	count: number;
	max_drift_st: number;
};

/** The labels of a take being uploaded. */
export type TakeMeta = {
	device_id: number;
	item: Item;
	intent: Intent;
	language?: string | null;
	content_ref?: string | null;
	recorded_at?: string | null;
	note?: string;
	client_id?: string | null;
	session_id?: string | null;
	exercise_ref?: string | null;
	target?: Target | null;
	comfort?: number | null;
};

/** A stored take with its labels, its analysis state and its metrics. */
export type TakeOut = {
	id: string;
	created_at: string;
	recorded_at: string;
	device_id: number;
	device_name: string;
	item: Item;
	intent: Intent;
	language: string | null;
	content_ref: string | null;
	note: string;
	original_name: string;
	sha256: string;
	sample_rate: number;
	channels: number;
	duration_s: number;
	analysis: AnalysisOut | null;
	metrics: Record<string, number>;
	details: Details;
	series: string[];
	client_id: string | null;
	session_id: string | null;
	exercise_ref: string | null;
	target: Target | null;
	comfort: number | null;
	evaluation: Evaluation | null;
};

/** Labels of a take to change; unset fields stay as they are. */
export type TakePatch = {
	device_id?: number | null;
	item?: Item | null;
	intent?: Intent | null;
	language?: string | null;
	content_ref?: string | null;
	recorded_at?: string | null;
	note?: string | null;
	comfort?: number | null;
};

/** What a practice take was recorded against. */
export type Target = {
	band_low_hz: number;
	band_high_hz: number;
	note_hz: number | null;
};

/** One sustained vowel, or held sound, found in a take. */
export type VowelSegment = {
	start_s: number;
	duration_s: number;
	vowel: string | null;
	pitch_hz: number;
	formants_hz: number[];
	cpps_db: number;
	hnr_db: number;
};
