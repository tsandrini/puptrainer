// Shared by the charts: tick placement and the series colours (the theme's
// validated pair; the colour follows the voice, never its position).

import type { Intent } from './api/types.js';

/** The intents that are a voice; drills are sounds made for an exercise and draw no line. */
export type Voice = Exclude<Intent, 'drill'>;

/** Series colours by the voice a take was spoken in. */
export const INTENT_COLOR: Record<Voice, string> = {
	habitual: 'var(--series-1)',
	attempt: 'var(--series-2)'
};

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

/** Evenly spread moments between two timestamps, ends included. */
export function timeTicks(from: number, to: number, count: number): number[] {
	if (to <= from || count < 2) return [from];
	return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}
