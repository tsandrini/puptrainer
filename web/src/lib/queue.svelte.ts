// The upload queue: every recording goes into IndexedDB first and leaves it
// only when the API has confirmed the take. Uploads are retried while the
// API is away; a take the API refuses stays, marked, until discarded.

import { ApiError } from './api/client.js';
import { createTake } from './api/index.js';
import type { TakeMeta, TakeOut } from './api/types.js';
import { allPending, deletePending, putPending, type Pending } from './store.js';

const RETRY_MS = 15_000;

/** What became of a take handed to the queue. */
export type Outcome = 'uploaded' | 'waiting' | 'rejected';

const newId = () =>
	globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

class UploadQueue {
	// NOTE: raw, since IndexedDB cannot clone the proxies deep state would make
	items = $state.raw<Pending[]>([]);
	busy = $state(false);
	#listeners = new Set<(take: TakeOut) => void>();

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

	/** Stores a recording and tries to upload it at once. */
	async add(bytes: ArrayBuffer, type: string, name: string, meta: TakeMeta): Promise<Outcome> {
		const id = newId();
		// NOTE: the id travels with the upload, so a retry of one that did reach the API
		// (a reload before the answer) is answered with the stored take, not a second one
		const item: Pending = {
			id,
			createdAt: Date.now(),
			name,
			type,
			bytes,
			meta: { ...meta, client_id: id }
		};
		await putPending(item);
		this.items = [...this.items, item];
		await this.flush();
		const left = this.items.find((i) => i.id === item.id);
		return !left ? 'uploaded' : left.rejected ? 'rejected' : 'waiting';
	}

	/** Uploads what is waiting, oldest first; stops at the first take the API cannot be reached for. */
	async flush(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			for (const item of this.items) {
				if (item.rejected) continue;
				try {
					const blob = new Blob([item.bytes], { type: item.type });
					const take = await createTake(blob, item.meta, item.name);
					await deletePending(item.id);
					this.items = this.items.filter((i) => i.id !== item.id);
					for (const listener of this.#listeners) listener(take);
				} catch (e) {
					const rejected = e instanceof ApiError && e.status >= 400 && e.status < 500;
					const next = { ...item, error: e instanceof Error ? e.message : String(e), rejected };
					await putPending(next);
					this.items = this.items.map((i) => (i.id === item.id ? next : i));
					if (!rejected) break;
				}
			}
		} finally {
			this.busy = false;
		}
	}

	/** Forgets a waiting take, recording included. */
	async discard(id: string): Promise<void> {
		await deletePending(id);
		this.items = this.items.filter((i) => i.id !== id);
	}
}

export const queue = new UploadQueue();
