import { describe, expect, it } from 'vitest';
import { fromInput, inRange, rangeProblem, resolveRange } from './range.js';

const NOW = Date.UTC(2026, 10, 21, 18, 0);
const DAY = 86_400_000;

describe('time ranges', () => {
	it('a quick range moves with the clock and has no end', () => {
		expect(resolveRange({ kind: 'quick', days: 7 }, NOW)).toEqual({
			from: NOW - 7 * DAY,
			to: null
		});
		expect(inRange({ kind: 'quick', days: 7 }, NOW - 6 * DAY, NOW)).toBe(true);
		expect(inRange({ kind: 'quick', days: 7 }, NOW - 8 * DAY, NOW)).toBe(false);
		// a take recorded a moment ago, after the page was opened, is inside
		expect(inRange({ kind: 'quick', days: 7 }, NOW + 60_000, NOW)).toBe(true);
	});

	it('everything is everything, and an exact range keeps its ends', () => {
		expect(inRange({ kind: 'all' }, 0, NOW)).toBe(true);
		const exact = { kind: 'absolute', from: NOW - 2 * DAY, to: NOW - DAY } as const;
		expect(inRange(exact, NOW - 1.5 * DAY, NOW)).toBe(true);
		expect(inRange(exact, NOW - DAY, NOW)).toBe(true);
		expect(inRange(exact, NOW, NOW)).toBe(false);
	});

	it('reads what a datetime-local input holds, and says what is wrong with a pair', () => {
		expect(fromInput('')).toBeNull();
		expect(fromInput('not a date')).toBeNull();
		expect(fromInput('2026-11-21T19:00')).toBe(new Date(2026, 10, 21, 19, 0).getTime());
		expect(rangeProblem(null, NOW)).toBe('incomplete');
		expect(rangeProblem(NOW, NOW - DAY)).toBe('backwards');
		expect(rangeProblem(NOW, NOW)).toBe('backwards');
		expect(rangeProblem(NOW - DAY, NOW)).toBeNull();
	});
});
