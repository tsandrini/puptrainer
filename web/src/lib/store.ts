// The upload queue's storage: takes and practice-session writes waiting
// for the API, kept in IndexedDB so that they survive a reload, a crash
// or the API being away. Bytes are stored as an ArrayBuffer (not a Blob:
// not every browser keeps those reliably).

import type { PracticeIn, TakeMeta } from './api/types.js';

type Common = {
	id: string;
	createdAt: number;
	/** Why the last upload did not go through. */
	error?: string;
	/** The API refused it (not audio, bad labels): retrying will not help. */
	rejected?: boolean;
};

/** A recording with its labels. */
export type PendingTake = Common & {
	kind?: 'take';
	name: string;
	type: string;
	bytes: ArrayBuffer;
	meta: TakeMeta;
};

/** A whole practice session to write (`PUT`), before and after its takes. */
export type PendingPractice = Common & {
	kind: 'practice';
	practiceId: string;
	body: PracticeIn;
};

export type Pending = PendingTake | PendingPractice;

/** Whether a queue item is a take; items stored before sessions existed have no `kind`. */
export const isTake = (item: Pending): item is PendingTake => item.kind !== 'practice';

const DB = 'puptrainer';
// NOTE: the store's name predates practice sessions; it holds both kinds in one
// order, so a session is always written before the takes that point to it
const STORE = 'pending-takes';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction(STORE, mode);
			const request = work(transaction.objectStore(STORE));
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

/** Everything waiting, oldest first. */
export const allPending = async (): Promise<Pending[]> =>
	(await run<Pending[]>('readonly', (s) => s.getAll())).sort((a, b) => a.createdAt - b.createdAt);

/** Adds a waiting item, or replaces the one with the same id. */
export const putPending = (item: Pending) => run('readwrite', (s) => s.put(item));

export const deletePending = (id: string) => run('readwrite', (s) => s.delete(id));
