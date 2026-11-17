// Generated from the API's models by `python -m puptrainer.api.tstypes`.
// Do not edit: change the models in backend/src/puptrainer/core/schemas.py and regenerate.

/** The latest analysis job of a take. */
export type AnalysisOut = {
	status: JobStatus;
	pipeline_version: string | null;
	error: string | null;
	finished_at: string | null;
};

/** Everything under `content/` the web app needs. */
export type Content = {
	passages: Passage[];
	protocols: Protocol[];
};

/** What an analysis found besides single numbers. */
export type Details = {
	vowels: VowelSegment[];
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

/** Liveness and queue state. */
export type Health = {
	status: string;
	version: string;
	pending_jobs: number;
	worker_seen_s: number | null;
	pipeline_version: string | null;
};

/** Which voice a take was spoken in. */
export type Intent = 'habitual' | 'attempt';

/** What a take contains. */
export type Item = 'vowels' | 'glide' | 'passage' | 'free' | 'other';

/** State of an analysis job. */
export type JobStatus = 'pending' | 'claimed' | 'done' | 'failed';

/** What the web app sends to sign in. */
export type Login = {
	token: string;
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

/** A reading passage. Its text is frozen once takes exist for a version. */
export type Passage = {
	id: string;
	language: string;
	version: number;
	title: string;
	text: string;
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
};

/** One sustained vowel found in a take. */
export type VowelSegment = {
	start_s: number;
	duration_s: number;
	vowel: string;
	pitch_hz: number;
	formants_hz: number[];
	cpps_db: number;
	hnr_db: number;
};
