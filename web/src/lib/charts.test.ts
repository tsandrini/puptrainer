import { describe, expect, it } from 'vitest';
import { stepDecimals } from './charts.js';

describe('stepDecimals', () => {
	it('gives the decimals a step between ticks needs', () => {
		expect([10, 1, 2.5, 0.5, 0.25, 0.1, 0.05].map(stepDecimals)).toEqual([0, 0, 1, 1, 2, 1, 2]);
		expect(stepDecimals(0.0004)).toBe(3);
	});
});
