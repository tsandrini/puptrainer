import { describe, expect, it } from 'vitest';
import { alignSteps, fitRange, overlay } from './compare.js';

/** A level series: silence, with sound over the given stretches of steps. */
const level = (length: number, ...sounds: [number, number][]) =>
	Array.from({ length }, (_, index) =>
		sounds.some(([from, to]) => index >= from && index < to) ? -20 : -60
	);

describe('lining two takes up', () => {
	it('moves the second so that its first sound starts with the first one’s', () => {
		const a = level(100, [20, 40], [60, 75]);
		const later = level(100, [28, 48], [70, 95]);
		expect(alignSteps(a, later)).toBe(-8);
		expect(alignSteps(later, a)).toBe(8);
		expect(alignSteps(a, a)).toBe(0);
	});

	it('does not take a click for a sound, nor move a take that has none', () => {
		const click = level(60, [5, 6], [30, 45]);
		expect(alignSteps(level(60, [30, 45]), click)).toBe(0);
		expect(alignSteps(level(50, [10, 20]), level(50))).toBe(0);
		expect(alignSteps([], [])).toBe(0);
	});

	it('copes with gaps in the level and with takes of different loudness', () => {
		const a = level(80, [10, 30]).map((v, index) => (index === 25 ? null : v));
		const b = level(80, [16, 36]).map((v) => v + 9);
		expect(alignSteps(a, b)).toBe(-6);
	});
});

describe('two takes on one axis', () => {
	const a = { start: 0.05, step: 0.1, values: [1, 2, 3] };
	const b = { start: 0.05, step: 0.1, values: [10, 20] };

	it('starts them together without a shift', () => {
		expect(overlay(a, b, 0)).toEqual({ x: [0.05, 0.15, 0.25], a: [1, 2, 3], b: [10, 20, null] });
	});

	it('moves the second later or earlier and widens the axis for it', () => {
		expect(overlay(a, b, 0.2)).toEqual({
			x: [0.05, 0.15, 0.25, 0.35],
			a: [1, 2, 3, null],
			b: [null, null, 10, 20]
		});
		const earlier = overlay(a, b, -0.1);
		expect(earlier.x[0]).toBeCloseTo(-0.05, 9);
		expect(earlier.b).toEqual([10, 20, null, null]);
		expect(earlier.a).toEqual([null, 1, 2, 3]);
	});

	it('draws one take alone when the other has no such series', () => {
		expect(overlay(a, null, 0).b).toEqual([null, null, null]);
		expect(overlay(null, null, 0).x).toEqual([]);
	});
});

describe('an axis without the strays', () => {
	it('leaves a far value out and never gets narrower than asked', () => {
		const values = [...Array.from({ length: 99 }, (_, index) => 100 + (index % 10)), -400];
		const [low, high] = fitRange(values, 5);
		expect(low).toBeGreaterThan(90);
		expect(high).toBeLessThan(115);
		const [from, to] = fitRange([5, 5, 5], 4);
		expect(to - from).toBeCloseTo(4.8, 9);
		expect(fitRange([null], 1)).toEqual([0, 1]);
	});
});
