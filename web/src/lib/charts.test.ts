import { describe, expect, it } from 'vitest';
import { niceTicks, timeTicks } from './charts.js';

describe('niceTicks', () => {
	it('covers the range with round steps', () => {
		expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
		expect(niceTicks(132, 218)).toEqual([125, 150, 175, 200, 225]);
		expect(niceTicks(17.2, 17.9, 3)).toEqual([17, 17.25, 17.5, 17.75, 18]);
		expect(niceTicks(-20.6, -18.7, 3)).toEqual([-21, -20, -19, -18]);
	});

	it('copes with a single value and with nonsense', () => {
		const ticks = niceTicks(159, 159);
		expect(ticks[0]).toBeLessThan(159);
		expect(ticks.at(-1)).toBeGreaterThan(159);
		expect(niceTicks(Number.NaN, 1)).toEqual([0, 1]);
	});
});

describe('timeTicks', () => {
	it('spreads moments evenly, ends included', () => {
		expect(timeTicks(0, 100, 5)).toEqual([0, 25, 50, 75, 100]);
		expect(timeTicks(5, 5, 4)).toEqual([5]);
	});
});
