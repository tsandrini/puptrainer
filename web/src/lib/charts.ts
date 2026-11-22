// Shared by the charts: the decimals of a tick, and what counts as a voice.

import type { Intent } from './api/types.js';

/** The intents that are a voice; drills are sounds made for an exercise, charted with it. */
export type Voice = Exclude<Intent, 'drill'>;

/** The decimals that tell the ticks of an axis apart, from the step between them. */
export function stepDecimals(step: number): number {
	for (let decimals = 0; decimals < 3; decimals++) {
		const scaled = Math.abs(step) * 10 ** decimals;
		if (scaled >= 1 && Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
	}
	return 3;
}
