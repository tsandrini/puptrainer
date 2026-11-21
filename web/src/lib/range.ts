// A stretch of time to look at: a quick range that moves with the clock
// ("the last 30 days"), everything, or an exact from and to.

export type TimeRange =
	| { kind: 'all' }
	| { kind: 'quick'; days: number }
	| { kind: 'absolute'; from: number; to: number };

/** What is wrong with a from and a to as typed. */
export type RangeProblem = 'incomplete' | 'backwards';

const DAY_MS = 86_400_000;

/**
 * The moments a range starts and ends at.
 *
 * @param range the range
 * @param now the clock, in ms since the epoch
 * @returns from and to in ms; an open end is `null`
 */
export function resolveRange(
	range: TimeRange,
	now: number
): { from: number | null; to: number | null } {
	if (range.kind === 'all') return { from: null, to: null };
	if (range.kind === 'quick') return { from: now - range.days * DAY_MS, to: null };
	return { from: range.from, to: range.to };
}

/** Whether a moment lies inside a range. */
export function inRange(range: TimeRange, moment: number, now: number): boolean {
	const { from, to } = resolveRange(range, now);
	return (from === null || moment >= from) && (to === null || moment <= to);
}

/** A moment from the text of a `datetime-local` input, in local time; null when it is none. */
export function fromInput(text: string): number | null {
	if (!text) return null;
	const moment = new Date(text).getTime();
	return Number.isFinite(moment) ? moment : null;
}

/** What keeps a typed from and to from being a range; null when they are one. */
export function rangeProblem(from: number | null, to: number | null): RangeProblem | null {
	if (from === null || to === null) return 'incomplete';
	return to > from ? null : 'backwards';
}
