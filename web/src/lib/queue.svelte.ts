// The upload queue: every recording goes into IndexedDB first and leaves it
// only when the API has confirmed the take. Practice sessions travel the
// same way, in the same order, so a session reaches the API before the
// takes that point to it. Uploads are retried while the API is away; an
// item the API refuses stays, marked, until discarded.

import { ApiError, Unauthorized } from './api/client.js';
import { createTake, putPractice } from './api/index.js';
import type { PracticeIn, TakeMeta, TakeOut } from './api/types.js';
import {
	allPending,
	deletePending,
	isTake,
	putPending,
	type Pending,
	type PendingTake
} from './store.js';

const RETRY_MS = 15_000;

/** What became of an item handed to the queue. */
export type Outcome = 'uploaded' | 'waiting' | 'rejected';

export const newId = () =>
	globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

class UploadQueue {
	// NOTE: raw, since IndexedDB cannot clone the proxies deep state would make
	items = $state.raw<Pending[]>([]);
	busy = $state(false);
	#listeners = new Set<(take: TakeOut) => void>();
	#running: Promise<void> | null = null;
	#again = false;

	/** The takes waiting (practice-session writes are small and not listed). */
	get takes(): PendingTake[] {
		return this.items.filter(isTake);
	}

	/** Loads what earlier visits left behind and keeps retrying. */
	async start(): Promise<void> {
		this.items = await allPending();
		addEventListener('online', () => void this.flush());
		setInterval(() => void this.flush(), RETRY_MS);
		await this.flush();
	}

	/** Calls `listener` with every take the API accepts; returns how to stop. */
	onUploaded(listener: (take: TakeOut) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Stores a recording and tries to upload it at once; `meta.client_id` is made when unset. */
	async add(bytes: ArrayBuffer, type: string, name: string, meta: TakeMeta): Promise<Outcome> {
		const id = meta.client_id ?? newId();
		// NOTE: the id travels with the upload, so a retry of one that did reach the API
		// (a reload before the answer) is answered with the stored take, not a second one
		const item: PendingTake = {
			id,
			createdAt: Date.now(),
			name,
			type,
			bytes,
			meta: { ...meta, client_id: id }
		};
		return this.#enqueue(item);
	}

	/**
	 * Writes a practice session (whole) through the queue, after what is already waiting.
	 *
	 * Resolves once the write is stored on the device, not when it reaches the API.
	 */
	async putPractice(practiceId: string, body: PracticeIn): Promise<void> {
		// NOTE: every write is an item of its own (the PUT is idempotent); replacing a
		// waiting one in place could lose the newer body to an upload already in flight
		await this.#store({ id: newId(), createdAt: Date.now(), kind: 'practice', practiceId, body });
		void this.flush();
	}

	async #store(item: Pending): Promise<void> {
		await putPending(item);
		this.items = [...this.items, item].sort((a, b) => a.createdAt - b.createdAt);
	}

	async #enqueue(item: Pending): Promise<Outcome> {
		await this.#store(item);
		await this.flush();
		const left = this.items.find((i) => i.id === item.id);
		return !left ? 'uploaded' : left.rejected ? 'rejected' : 'waiting';
	}

	/**
	 * Uploads what is waiting, oldest first; stops at the first item the API cannot be
	 * reached for. A call while uploads run waits for them, and for one more pass over
	 * what was added meanwhile.
	 */
	flush(): Promise<void> {
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}
		this.busy = true;
		this.#running = (async () => {
			try {
				do {
					this.#again = false;
					await this.#pass();
				} while (this.#again);
			} finally {
				this.busy = false;
				this.#running = null;
			}
		})();
		return this.#running;
	}

	async #pass(): Promise<void> {
		for (const item of this.items) {
			if (item.rejected) continue;
			try {
				let take: TakeOut | null = null;
				if (isTake(item)) {
					const blob = new Blob([item.bytes], { type: item.type });
					take = await createTake(blob, item.meta, item.name);
				} else {
					await putPractice(item.practiceId, item.body);
				}
				await deletePending(item.id);
				this.items = this.items.filter((i) => i.id !== item.id);
				if (take) for (const listener of this.#listeners) listener(take);
			} catch (e) {
				// NOTE: signed out is like offline: the item waits, it is not refused
				const rejected =
					!(e instanceof Unauthorized) &&
					e instanceof ApiError &&
					e.status >= 400 &&
					e.status < 500;
				const next = { ...item, error: e instanceof Error ? e.message : String(e), rejected };
				await putPending(next);
				this.items = this.items.map((i) => (i.id === item.id ? next : i));
				if (!rejected) break;
			}
		}
	}

	/** Forgets a waiting item, a recording included. */
	async discard(id: string): Promise<void> {
		await deletePending(id);
		this.items = this.items.filter((i) => i.id !== id);
	}
}

export const queue = new UploadQueue();
