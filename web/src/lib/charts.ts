// Shared by the charts: tick placement and what counts as a voice.

import type { Intent } from './api/types.js';

/** The intents that are a voice; drills are sounds made for an exercise, charted with it. */
export type Voice = Exclude<Intent, 'drill'>;

/** Round tick values covering `min`…`max`, about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
	if (min === max) {
		const pad = Math.abs(min) * 0.05 || 1;
		min -= pad;
		max += pad;
	}
	const rough = (max - min) / count;
	const power = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
	const first = Math.floor(min / step) * step;
	const ticks: number[] = [];
	for (let value = first; value < max + step; value += step) {
		ticks.push(Number(value.toPrecision(12)));
		if (value >= max) break;
	}
	return ticks;
}

/** The decimals that tell the ticks of an axis apart, from the step between them. */
export function stepDecimals(step: number): number {
	for (let decimals = 0; decimals < 3; decimals++) {
		const scaled = Math.abs(step) * 10 ** decimals;
		if (scaled >= 1 && Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
	}
	return 3;
}
