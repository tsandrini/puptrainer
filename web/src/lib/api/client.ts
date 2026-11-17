// The API under `/api/v1`: JSON helpers, `ApiError` for a rejected request,
// `Unauthorized` when the API asks for its access token, and `Offline` when
// it cannot be reached at all.

/** A rejected request, with the API's status and its `error` text. */
export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

/** The request never got an answer: the API is down or the network is. */
export class Offline extends Error {}

/** The API asks for its access token: the session's cookie is missing or stale. */
export class Unauthorized extends Error {}

/** Called on every 401, so the shell can ask for the token. */
export const auth: { onUnauthorized: (() => void) | null } = { onUnauthorized: null };

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(`/api/v1/${path}`, init);
	} catch (e) {
		throw new Offline(e instanceof Error ? e.message : String(e));
	}
	// NOTE: the dev proxy answers 502/504 itself when the API is not running
	if (res.status === 502 || res.status === 504) throw new Offline(`${res.status}`);
	if (res.status === 401 && path !== 'login') {
		auth.onUnauthorized?.();
		throw new Unauthorized();
	}
	if (!res.ok) {
		const text = await res.text();
		let message = text;
		try {
			message = JSON.parse(text).error || text;
		} catch {
			// not JSON
		}
		throw new ApiError(message || `${res.status} ${res.statusText}`, res.status);
	}
	return res;
}

export const getJson = async <T>(path: string): Promise<T> => (await api(path)).json();

const withBody = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body)
});

export const postJson = async <T>(path: string, body: unknown): Promise<T> =>
	(await api(path, withBody('POST', body))).json();

export const putJson = async <T>(path: string, body: unknown): Promise<T> =>
	(await api(path, withBody('PUT', body))).json();

export const patchJson = async <T>(path: string, body: unknown): Promise<T> =>
	(await api(path, withBody('PATCH', body))).json();

/** `?a=1&b=2` from defined values only. */
export function query(params: Record<string, string | number | undefined | null>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
	}
	const s = q.toString();
	return s ? `?${s}` : '';
}
