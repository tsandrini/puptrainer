// Two takes on one time axis: how far the second has to be moved for the two
// to begin together, and their values side by side moment by moment.

type Values = readonly (number | null)[];

/** How far a level has to stand above the quietest moments to count as sound, in dB. */
const SOUND_DB = 12;

/** A level series as "sounds or not", so that loud and soft takes line up alike. */
function sounding(levels: Values): number[] {
	const heard = levels.filter((v): v is number => v !== null).sort((a, b) => a - b);
	if (!heard.length) return levels.map(() => 0);
	const floor = heard[Math.floor(heard.length * 0.1)];
	return levels.map((value) => (value !== null && value >= floor + SOUND_DB ? 1 : 0));
}

/** A sound has to last this many steps to count as the take's first one. */
const ONSET_STEPS = 3;

/** The step at which a take's first sound starts; null when it has none. */
function onset(levels: Values): number | null {
	const series = sounding(levels);
	let run = 0;
	for (let index = 0; index < series.length; index++) {
		run = series[index] ? run + 1 : 0;
		if (run === ONSET_STEPS) return index - ONSET_STEPS + 1;
	}
	return null;
}

/**
 * How many steps the second take has to be moved (later is positive) for its first
 * sound to start with the first one's. Two takes are rarely paced alike, so nothing
 * lines all of their sounds up at once; the first one is the place both began from.
 * 0 when either has no sound, or is sound from its first step.
 *
 * @param a The first take's level, a value per step.
 * @param b The second take's level, on the same step.
 */
export function alignSteps(a: Values, b: Values): number {
	const [first, second] = [onset(a), onset(b)];
	return first === null || second === null ? 0 : first - second;
}

/** One series of each take, with where it starts and the step between its values. */
export type Track = { start: number; step: number; values: Values };

/**
 * Two takes' values on one axis: a moment per step from the earlier start to the
 * later end, with each take's value at it (null where it has none).
 *
 * @param shift How far the second take is moved, in seconds (later is positive).
 */
export function overlay(
	a: Track | null,
	b: Track | null,
	shift: number
): { x: number[]; a: (number | null)[]; b: (number | null)[] } {
	const step = a?.step ?? b?.step ?? 0.1;
	const ends = [
		...(a ? [a.start, a.start + (a.values.length - 1) * a.step] : []),
		...(b ? [b.start + shift, b.start + shift + (b.values.length - 1) * b.step] : [])
	];
	if (!ends.length) return { x: [], a: [], b: [] };
	const from = Math.min(...ends);
	const count = Math.round((Math.max(...ends) - from) / step) + 1;
	const x = Array.from(
		{ length: count },
		(_, index) => Math.round((from + index * step) * 1000) / 1000
	);
	const at = (track: Track | null, moved: number) =>
		x.map((moment) => {
			if (!track) return null;
			const index = Math.round((moment - moved - track.start) / track.step);
			return index >= 0 && index < track.values.length ? track.values[index] : null;
		});
	return { x, a: at(a, 0), b: at(b, shift) };
}

/** Ends for a value axis that leave the strays out: the 2nd to the 98th percentile, padded. */
export function fitRange(values: Values, least: number): [number, number] {
	const sorted = values
		.filter((v): v is number => v !== null && Number.isFinite(v))
		.sort((a, b) => a - b);
	if (!sorted.length) return [0, 1];
	let low = sorted[Math.floor((sorted.length - 1) * 0.02)];
	let high = sorted[Math.ceil((sorted.length - 1) * 0.98)];
	if (high - low < least) {
		const middle = (low + high) / 2;
		[low, high] = [middle - least / 2, middle + least / 2];
	}
	const margin = (high - low) * 0.1;
	return [low - margin, high + margin];
}
