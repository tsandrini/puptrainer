// The list a take was opened from (the takes table as it was filtered and
// sorted), so that a take's page can step to the one before and after it
// without a trip back to the table. Kept for the visit only.

const KEY = 'puptrainer.trail';

/** Remember the ids of a list, in its order. */
export function saveTrail(ids: readonly string[]): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(ids));
	} catch {
		// NOTE: without storage there is no stepping, and nothing else is lost
	}
}

/** Where an id sits in the remembered list: its neighbours, its place; null when it is not in it. */
export function trailAround(
	id: string
): { previous: string | null; next: string | null; place: number; length: number } | null {
	let ids: unknown;
	try {
		ids = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
	} catch {
		return null;
	}
	if (!Array.isArray(ids)) return null;
	const at = ids.indexOf(id);
	if (at < 0) return null;
	return {
		previous: (ids[at - 1] as string | undefined) ?? null,
		next: (ids[at + 1] as string | undefined) ?? null,
		place: at + 1,
		length: ids.length
	};
}
