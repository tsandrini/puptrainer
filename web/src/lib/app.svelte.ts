// What every page needs from the API: the content (passages, protocols),
// the metric registry, the microphone setups, and whether the API and its
// analysis worker are there.

import { Offline } from './api/client.js';
import { fetchContent, fetchDevices, fetchHealth, fetchMetrics } from './api/index.js';
import type { Content, DeviceOut, Health, MetricDef, Passage } from './api/types.js';
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

	/** Loads everything once and keeps an eye on the API. */
	start(): void {
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
			else this.error = e instanceof Error ? e.message : String(e);
		}
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

	passage(ref: string | null | undefined): Passage | null {
		if (!ref) return null;
		return this.content?.passages.find((p) => passageRef(p) === ref) ?? null;
	}
}

export const app = new AppData();
