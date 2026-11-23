// What every page needs from the API: the content (passages, protocols,
// the exercise catalogue), the metric registry and the evaluation's
// measures, the microphone setups, the people, the pitch band, and whether
// the API and its analysis worker are there.

import { ApiError, Offline, Unauthorized, auth } from './api/client.js';
import {
	createBand,
	fetchBands,
	fetchContent,
	fetchDevices,
	fetchHealth,
	fetchMeasures,
	fetchMetrics,
	fetchPeople,
	fetchSession,
	login,
	logout
} from './api/index.js';
import type {
	BandOut,
	Content,
	DeviceOut,
	Exercise,
	Health,
	Item,
	MeasureDef,
	MetricDef,
	MetricGroup,
	Passage,
	PersonOut,
	Routine
} from './api/types.js';
import { passageRef } from './labels.js';

const POLL_MS = 5_000;
/** The worker asks for work every couple of seconds; silence this long means it is down. */
const WORKER_QUIET_S = 30;

class AppData {
	content = $state.raw<Content | null>(null);
	metrics = $state.raw<MetricDef[]>([]);
	measures = $state.raw<MeasureDef[]>([]);
	devices = $state.raw<DeviceOut[]>([]);
	/** Everyone whose voice is here; the default person first. */
	people = $state.raw<PersonOut[]>([]);
	/** The current pitch band; `null` until one is set. */
	band = $state.raw<BandOut | null>(null);
	health = $state.raw<Health | null>(null);
	reachable = $state(true);
	loaded = $state(false);
	error = $state<string | null>(null);
	/** The API asks for its access token and this browser has not given it. */
	needLogin = $state(false);
	/** The API has a token at all (so signing out makes sense). */
	loginRequired = $state(false);

	/** Loads everything once and keeps an eye on the API. */
	start(): void {
		auth.onUnauthorized = () => (this.needLogin = true);
		void fetchSession()
			.then((session) => {
				this.loginRequired = session.login_required;
				this.needLogin = !session.signed_in;
			})
			.catch(() => {
				// NOTE: the poll below says when the API is away
			});
		void this.load();
		void this.poll();
		setInterval(() => void this.poll(), POLL_MS);
	}

	async load(): Promise<void> {
		try {
			let bands: BandOut[];
			[this.content, this.metrics, this.measures, this.devices, this.people, bands] =
				await Promise.all([
					fetchContent(),
					fetchMetrics(),
					fetchMeasures(),
					fetchDevices(),
					fetchPeople(),
					fetchBands()
				]);
			this.band = bands[0] ?? null;
			this.loaded = true;
			this.reachable = true;
			this.error = null;
		} catch (e) {
			if (e instanceof Offline) this.reachable = false;
			else if (!(e instanceof Unauthorized))
				this.error = e instanceof Error ? e.message : String(e);
		}
	}

	/**
	 * Signs in with the access token.
	 *
	 * @returns whether the token was accepted
	 * @throws Offline when the API cannot be reached
	 */
	async signIn(token: string): Promise<boolean> {
		try {
			await login(token);
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) return false;
			throw e;
		}
		this.needLogin = false;
		this.loginRequired = true;
		await this.load();
		return true;
	}

	async signOut(): Promise<void> {
		await logout();
		this.needLogin = true;
	}

	async refreshDevices(): Promise<void> {
		this.devices = await fetchDevices();
	}

	async refreshPeople(): Promise<void> {
		this.people = await fetchPeople();
	}

	/**
	 * The default person: the one who trains with the app. Every take is read against
	 * their everyday voice, and the analyses show them unless others are picked.
	 */
	get me(): PersonOut | null {
		return this.people.find((person) => person.is_default) ?? null;
	}

	person(id: number | null | undefined): PersonOut | null {
		return this.people.find((person) => person.id === id) ?? null;
	}

	/** Sets a new pitch band; the old ones stay in the history. */
	async setBand(low: number, high: number): Promise<void> {
		this.band = await createBand({ low_hz: low, high_hz: high });
	}

	async poll(): Promise<void> {
		try {
			this.health = await fetchHealth();
			this.reachable = true;
			if (!this.loaded) await this.load();
		} catch {
			this.reachable = false;
		}
	}

	/** Takes are queued for analysis and nothing is picking them up. */
	get workerDown(): boolean {
		const health = this.health;
		if (!this.reachable || !health || health.pending_jobs === 0) return false;
		return health.worker_seen_s === null || health.worker_seen_s > WORKER_QUIET_S;
	}

	metric(key: string): MetricDef | undefined {
		return this.metrics.find((m) => m.key === key);
	}

	/** A number a judgement shows: one of the evaluation's measures or a registry metric. */
	measure(key: string): MeasureDef | MetricDef | undefined {
		return this.measures.find((m) => m.key === key) ?? this.metric(key);
	}

	exercise(id: string | null | undefined): Exercise | null {
		return this.content?.exercises.find((e) => e.id === id) ?? null;
	}

	/** The exercise a take was recorded for, from its `exercise:<id>@<version>`. */
	exerciseOf(ref: string | null | undefined): Exercise | null {
		const match = ref?.match(/^exercise:([a-z0-9-]+)@\d+$/);
		return match ? this.exercise(match[1]) : null;
	}

	routine(id: string | null | undefined): Routine | null {
		return this.content?.routines.find((r) => r.id === id) ?? null;
	}

	/** The routine a session followed, from its `routine:<id>@<version>`. */
	routineOf(ref: string | null | undefined): Routine | null {
		const match = ref?.match(/^routine:([a-z0-9-]+)@\d+$/);
		return match ? this.routine(match[1]) : null;
	}

	/** The registry's metrics that apply to a kind of take, by group, in registry order. */
	groups(item: Item): { group: MetricGroup; metrics: MetricDef[] }[] {
		const out: { group: MetricGroup; metrics: MetricDef[] }[] = [];
		for (const metric of this.metrics) {
			if (metric.items && !metric.items.includes(item)) continue;
			const last = out.at(-1);
			if (last?.group === metric.group) last.metrics.push(metric);
			else out.push({ group: metric.group, metrics: [metric] });
		}
		return out;
	}

	passage(ref: string | null | undefined): Passage | null {
		if (!ref) return null;
		return this.content?.passages.find((p) => passageRef(p) === ref) ?? null;
	}
}

export const app = new AppData();
