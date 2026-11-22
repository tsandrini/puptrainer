// A small setting kept in localStorage: which columns a table shows, which
// way a chart is drawn. Unlike a page's view it is not part of a link.
import { browser } from '$app/env';

const PREFIX = 'puptrainer.';

export class Kept<T> {
	value: T;
	readonly #key: string;

	/**
	 * @param key What it is, e.g. `columns.takes`.
	 * @param fallback The value of a first visit, and of anything stored that cannot be read.
	 */
	constructor(key: string, fallback: T) {
		this.#key = PREFIX + key;
		let stored: T = fallback;
		if (browser) {
			try {
				const raw = localStorage.getItem(this.#key);
				if (raw !== null) stored = JSON.parse(raw) as T;
			} catch {
				// NOTE: a value we cannot read is a first visit
			}
		}
		this.value = $state(stored);
	}

	set(next: T): void {
		this.value = next;
		if (!browser) return;
		try {
			localStorage.setItem(this.#key, JSON.stringify(next));
		} catch {
			// NOTE: a full or forbidden storage: the setting lasts for the visit
		}
	}
}
