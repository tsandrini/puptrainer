import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
	allPending,
	deletePending,
	isTake,
	putPending,
	type Pending,
	type PendingPractice,
	type PendingTake
} from './store.js';

const take = (id: string, createdAt: number): PendingTake => ({
	id,
	createdAt,
	name: `${id}.wav`,
	type: 'audio/wav',
	bytes: new Uint8Array([1, 2, 3, 4]).buffer,
	meta: { device_id: 1, item: 'free', intent: 'habitual' }
});

describe('pending takes', () => {
	it('keeps takes with their bytes, oldest first, until deleted', async () => {
		expect(await allPending()).toEqual([]);
		await putPending(take('b', 2));
		await putPending(take('a', 1));
		const stored = await allPending();
		expect(stored.map((t) => t.id)).toEqual(['a', 'b']);
		const first = stored[0] as PendingTake;
		expect([...new Uint8Array(first.bytes)]).toEqual([1, 2, 3, 4]);
		expect(first.meta).toEqual({ device_id: 1, item: 'free', intent: 'habitual' });

		await putPending({ ...take('a', 1), error: 'offline', rejected: true });
		expect((await allPending())[0]).toMatchObject({ error: 'offline', rejected: true });

		await deletePending('a');
		await deletePending('missing');
		expect((await allPending()).map((t) => t.id)).toEqual(['b']);
		await deletePending('b');
	});

	it('keeps practice sessions in the same order as takes', async () => {
		const session: PendingPractice = {
			id: 's',
			createdAt: 1,
			kind: 'practice',
			practiceId: 'session-0001',
			body: { started_at: '2026-11-18T08:00:00Z' }
		};
		// NOTE: a take stored before sessions existed has no `kind`
		const legacy = take('t', 2) as Pending;
		await putPending(legacy);
		await putPending(session);
		const stored = await allPending();
		expect(stored.map((i) => i.id)).toEqual(['s', 't']);
		expect(stored.map(isTake)).toEqual([false, true]);
		await deletePending('s');
		await deletePending('t');
	});
});
