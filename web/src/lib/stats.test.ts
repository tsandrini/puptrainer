import { describe, expect, it } from 'vitest';
import { byDay, dayOf, deviation, extent, fitLine, median, pearson, quantile } from './stats.js';

describe('statistics', () => {
	it('finds quantiles by interpolation', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
		expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
		expect(quantile([], 0.5)).toBeNaN();
	});

	it('measures spread, and says so when it cannot', () => {
		expect(deviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
		expect(deviation([1])).toBeNaN();
	});

	it('says how closely pairs follow a line, and which line', () => {
		const up: [number, number][] = [
			[1, 2],
			[2, 4],
			[3, 6],
			[4, 8]
		];
		expect(pearson(up)).toBeCloseTo(1, 9);
		expect(pearson(up.map(([x, y]) => [x, -y] as [number, number]))).toBeCloseTo(-1, 9);
		expect(fitLine(up)).toEqual({ slope: 2, intercept: 0 });
		expect(pearson(up.slice(0, 2))).toBeNull();
		expect(pearson(up.map(([x]) => [x, 5] as [number, number]))).toBeNull();
		expect(fitLine(up.map(([, y]) => [1, y] as [number, number]))).toBeNull();
	});

	it('groups by the local day', () => {
		const at = (h: number, d = 21) => new Date(2026, 10, d, h).getTime();
		const days = byDay([at(18), at(9), at(10, 20)], (m) => m);
		expect(days.map((d) => d.items.length)).toEqual([1, 2]);
		expect(days[1].day).toBe(dayOf(at(23)));
	});

	it('frames an axis around its values', () => {
		expect(extent([0, 10], { pad: 0.1 })).toEqual([-1, 11]);
		const [low, high] = extent([0.0001, 0.0003], { least: 2, pad: 0 });
		expect(high - low).toBeCloseTo(2, 9);
		expect(extent([5], { include: [0], pad: 0 })).toEqual([0, 5]);
		expect(extent([])).toEqual([0, 1]);
	});
});
