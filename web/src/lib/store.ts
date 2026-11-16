// Takes waiting to be uploaded, kept in IndexedDB so that a recording
// survives a reload, a crash or the API being away. Bytes are stored as an
// ArrayBuffer (not a Blob: not every browser keeps those reliably).

import type { TakeMeta } from './api/types.js';

export type Pending = {
	id: string;
	createdAt: number;
	name: string;
	type: string;
	bytes: ArrayBuffer;
	meta: TakeMeta;
	/** Why the last upload did not go through. */
	error?: string;
	/** The API refused it (not audio, bad labels): retrying will not help. */
	rejected?: boolean;
};

const DB = 'puptrainer';
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

/** Every waiting take, oldest first. */
export const allPending = async (): Promise<Pending[]> =>
	(await run<Pending[]>('readonly', (s) => s.getAll())).sort((a, b) => a.createdAt - b.createdAt);

/** Adds a waiting take, or replaces the one with the same id. */
export const putPending = (item: Pending) => run('readwrite', (s) => s.put(item));

export const deletePending = (id: string) => run('readwrite', (s) => s.delete(id));
