// The few statistics the charts need, on plain arrays of numbers.

export const mean = (values: readonly number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

/** A quantile (0 to 1) of values, by linear interpolation; NaN for none. */
export function quantile(values: readonly number[], q: number): number {
	if (!values.length) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const at = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
	const low = Math.floor(at);
	return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);
}

export const median = (values: readonly number[]): number => quantile(values, 0.5);

/** The sample standard deviation; NaN with fewer than two values. */
export function deviation(values: readonly number[]): number {
	if (values.length < 2) return Number.NaN;
	const middle = mean(values);
	return Math.sqrt(values.reduce((sum, v) => sum + (v - middle) ** 2, 0) / (values.length - 1));
}

/** How closely pairs follow a straight line (Pearson's r); null with fewer than three or no spread. */
export function pearson(pairs: readonly (readonly [number, number])[]): number | null {
	const n = pairs.length;
	if (n < 3) return null;
	const mx = mean(pairs.map((p) => p[0]));
	const my = mean(pairs.map((p) => p[1]));
	let [sxy, sxx, syy] = [0, 0, 0];
	for (const [x, y] of pairs) {
		sxy += (x - mx) * (y - my);
		sxx += (x - mx) ** 2;
		syy += (y - my) ** 2;
	}
	return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** The least-squares line through pairs; null with fewer than three or no spread in x. */
export function fitLine(
	pairs: readonly (readonly [number, number])[]
): { slope: number; intercept: number } | null {
	if (pairs.length < 3) return null;
	const mx = mean(pairs.map((p) => p[0]));
	const my = mean(pairs.map((p) => p[1]));
	const sxx = pairs.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
	if (!sxx) return null;
	const slope = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0) / sxx;
	return { slope, intercept: my - slope * mx };
}

/** The local midnight a moment (ms) belongs to, in ms. */
export function dayOf(moment: number): number {
	const day = new Date(moment);
	day.setHours(0, 0, 0, 0);
	return day.getTime();
}

/** Items by the local day they fall on, days in order. */
export function byDay<T>(
	items: readonly T[],
	at: (item: T) => number
): { day: number; items: T[] }[] {
	const days: Record<number, T[]> = {};
	for (const item of items) (days[dayOf(at(item))] ??= []).push(item);
	return Object.keys(days)
		.map(Number)
		.sort((a, b) => a - b)
		.map((day) => ({ day, items: days[day] }));
}

/** Ends for an axis that follows its values: padded, never narrower than `least`, covering `include`. */
export function extent(
	values: readonly number[],
	{
		include = [],
		least = 0,
		pad = 0.08
	}: { include?: readonly number[]; least?: number; pad?: number } = {}
): [number, number] {
	const all = [...values, ...include].filter((v) => Number.isFinite(v));
	if (!all.length) return [0, 1];
	let [low, high] = [Math.min(...all), Math.max(...all)];
	if (high - low < least) {
		const middle = (low + high) / 2;
		[low, high] = [middle - least / 2, middle + least / 2];
	}
	const margin = high > low ? (high - low) * pad : Math.abs(high) * 0.1 || 1;
	return [low - margin, high + margin];
}
