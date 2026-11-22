// A page's view, kept where a reload, the back button and a return through
// the navigation all find it again: in the URL's query, and per page in
// sessionStorage for an arrival without a query. Made in a component's
// script; `value` is state, so binding to its fields is all a page does.
import { untrack } from 'svelte';
import { browser } from '$app/env';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import { decodeView, encodeView, mentionsView, type View } from './view.js';

const KEY = 'puptrainer.view.';

export class ViewState<T extends View> {
	value: T;
	readonly #defaults: T;

	/**
	 * @param name What the view is of; one per page.
	 * @param defaults The view of a first visit: every key with its type.
	 */
	constructor(name: string, defaults: T) {
		this.#defaults = defaults;
		const stored = browser ? (sessionStorage.getItem(KEY + name) ?? '') : '';
		const query = browser ? location.search.slice(1) : '';
		// NOTE: a link that says something wins over what was left behind
		this.value = $state(decodeView(mentionsView(query, defaults) ? query : stored, defaults));

		$effect(() => {
			const next = encodeView($state.snapshot(this.value) as T, defaults);
			if (!browser) return;
			sessionStorage.setItem(KEY + name, next);
			untrack(() => write(next));
		});
	}

	/** Whether anything differs from a first visit. */
	get changed(): boolean {
		return encodeView($state.snapshot(this.value) as T, this.#defaults) !== '';
	}

	/** Back to the view of a first visit. */
	reset(): void {
		Object.assign(this.value, decodeView('', this.#defaults));
	}
}

/** Put a query into the address bar without a navigation. */
function write(query: string, again = true): void {
	if (location.search.slice(1) === query) return;
	try {
		replaceState(location.pathname + (query ? `?${query}` : '') + location.hash, page.state);
	} catch {
		// NOTE: the router is not up yet on a first load: once more after it is
		if (again) setTimeout(() => write(query, false), 0);
	}
}
