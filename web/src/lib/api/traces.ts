// Traces already fetched, for the views that show the same take again (the
// dock while a list is walked through). A take's trace changes only when it
// is analysed again, and a reload forgets all of them.
import { fetchTrace } from './index.js';
import type { Trace } from './types.js';

const KEPT = 40;
const kept = new Map<string, Promise<Trace>>();

/** A take's trace, from memory when it was asked for before. */
export function cachedTrace(id: string): Promise<Trace> {
	let trace = kept.get(id);
	if (!trace) {
		trace = fetchTrace(id);
		trace.catch(() => kept.delete(id));
		kept.set(id, trace);
		if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
	}
	return trace;
}

/** Forget a take's trace, e.g. when it was analysed again. */
export const dropTrace = (id: string) => kept.delete(id);
