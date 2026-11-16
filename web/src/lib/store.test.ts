import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { allPending, deletePending, putPending, type Pending } from './store.js';

const take = (id: string, createdAt: number): Pending => ({
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
		expect([...new Uint8Array(stored[0].bytes)]).toEqual([1, 2, 3, 4]);
		expect(stored[0].meta).toEqual({ device_id: 1, item: 'free', intent: 'habitual' });

		await putPending({ ...take('a', 1), error: 'offline', rejected: true });
		expect((await allPending())[0]).toMatchObject({ error: 'offline', rejected: true });

		await deletePending('a');
		await deletePending('missing');
		expect((await allPending()).map((t) => t.id)).toEqual(['b']);
	});
});
