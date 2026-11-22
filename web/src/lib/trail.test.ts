// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { saveTrail, trailAround } from './trail.js';

const kept = new Map<string, string>();
beforeEach(() => {
	kept.clear();
	globalThis.sessionStorage = {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => void kept.set(key, value)
	} as Storage;
});

describe('the list a take was opened from', () => {
	it('gives a take its neighbours and its place', () => {
		saveTrail(['a', 'b', 'c']);
		expect(trailAround('b')).toEqual({ previous: 'a', next: 'c', place: 2, length: 3 });
		expect(trailAround('a')).toEqual({ previous: null, next: 'b', place: 1, length: 3 });
		expect(trailAround('c')?.next).toBeNull();
	});

	it('knows nothing of a take that was not in the list, or of a list that was never kept', () => {
		expect(trailAround('a')).toBeNull();
		saveTrail(['a']);
		expect(trailAround('z')).toBeNull();
		kept.set('puptrainer.trail', 'not json');
		expect(trailAround('a')).toBeNull();
	});
});
