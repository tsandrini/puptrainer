// What every page needs from the API: the content (passages, protocols),
// the metric registry, the microphone setups, and whether the API and its
// analysis worker are there.

import { ApiError, Offline, Unauthorized, auth } from './api/client.js';
import {
	fetchContent,
	fetchDevices,
	fetchHealth,
	fetchMetrics,
	fetchSession,
	login,
	logout
} from './api/index.js';
import type {
	Content,
	DeviceOut,
	Health,
	Item,
	MetricDef,
	MetricGroup,
	Passage
} from './api/types.js';
import { passageRef } from './labels.js';

const POLL_MS = 5_000;
/** The worker asks for work every couple of seconds; silence this long means it is down. */
const WORKER_QUIET_S = 30;

class AppData {
	content = $state.raw<Content | null>(null);
	metrics = $state.raw<MetricDef[]>([]);
	devices = $state.raw<DeviceOut[]>([]);
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
			[this.content, this.metrics, this.devices] = await Promise.all([
				fetchContent(),
				fetchMetrics(),
				fetchDevices()
			]);
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
