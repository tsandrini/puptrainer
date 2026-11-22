// What a page shows (its filters, its sorting, the tab that is open) as a
// query string, so that it can live in the URL and in sessionStorage. Only
// what differs from the defaults is written.

export type ViewValue = string | number | boolean | string[];
export type View = Record<string, ViewValue>;

const same = (a: ViewValue, b: ViewValue) =>
	Array.isArray(a) && Array.isArray(b)
		? a.length === b.length && a.every((value, index) => value === b[index])
		: a === b;

/** A view as a query string (no leading "?"); empty when it is the default view. */
export function encodeView<T extends View>(view: T, defaults: T): string {
	const params = new URLSearchParams();
	for (const key of Object.keys(defaults)) {
		const value = view[key];
		if (value === undefined || same(value, defaults[key])) continue;
		params.set(
			key,
			Array.isArray(value)
				? value.join(',')
				: typeof value === 'boolean'
					? value
						? '1'
						: '0'
					: `${value}`
		);
	}
	return params.toString();
}

/** A view from a query string: what the query does not say (or says badly) is the default. */
export function decodeView<T extends View>(query: string, defaults: T): T {
	const params = new URLSearchParams(query);
	const view: View = {};
	for (const [key, fallback] of Object.entries(defaults)) {
		const raw = params.get(key);
		if (raw === null) view[key] = Array.isArray(fallback) ? [...fallback] : fallback;
		else if (Array.isArray(fallback)) view[key] = raw ? raw.split(',') : [];
		else if (typeof fallback === 'boolean') view[key] = raw === '1';
		else if (typeof fallback === 'number')
			view[key] = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
		else view[key] = raw;
	}
	return view as T;
}

/** Whether a query says anything about a view's keys. */
export function mentionsView(query: string, defaults: View): boolean {
	const params = new URLSearchParams(query);
	return Object.keys(defaults).some((key) => params.has(key));
}
