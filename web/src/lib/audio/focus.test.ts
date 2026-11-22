import { describe, expect, it } from 'vitest';
import { claimSound, hush, releaseSound } from './focus.js';

describe('the floor', () => {
	it('silences the previous holder when another starts, not itself', () => {
		const [a, b] = [Symbol('a'), Symbol('b')];
		const stopped: string[] = [];
		claimSound(a, () => stopped.push('a'));
		claimSound(a, () => stopped.push('a again'));
		expect(stopped).toEqual([]);
		claimSound(b, () => stopped.push('b'));
		expect(stopped).toEqual(['a again']);
		releaseSound(a);
		hush();
		expect(stopped).toEqual(['a again', 'b']);
		hush();
		expect(stopped).toHaveLength(2);
	});

	it('forgets a holder that is done', () => {
		const a = Symbol('a');
		let stops = 0;
		claimSound(a, () => stops++);
		releaseSound(a);
		hush();
		expect(stops).toBe(0);
	});
});
