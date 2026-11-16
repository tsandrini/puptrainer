// The colour theme: follow the system, or stay light or dark. The choice is
// kept in localStorage; `app.html` applies it before the first paint.

import { browser } from '$app/env';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'puptrainer.theme';
const COLOR = { light: '#fbf6f6', dark: '#1d151c' } as const;

class Theme {
	mode = $state<ThemeMode>(
		browser ? ((localStorage.getItem(KEY) as ThemeMode | null) ?? 'system') : 'system'
	);
	#system = browser ? matchMedia('(prefers-color-scheme: dark)') : null;

	/** Whether the page is dark right now. */
	get dark(): boolean {
		return this.mode === 'dark' || (this.mode === 'system' && Boolean(this.#system?.matches));
	}

	/** Applies the theme and follows the system while the mode says so. */
	start(): () => void {
		this.apply();
		const follow = () => this.apply();
		this.#system?.addEventListener('change', follow);
		return () => this.#system?.removeEventListener('change', follow);
	}

	set(mode: ThemeMode): void {
		this.mode = mode;
		if (browser) localStorage.setItem(KEY, mode);
		this.apply();
	}

	apply(): void {
		if (!browser) return;
		const dark = this.dark;
		document.documentElement.classList.toggle('dark', dark);
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', dark ? COLOR.dark : COLOR.light);
	}
}

export const theme = new Theme();
