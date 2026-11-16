// The interface language: English by default, Czech when the browser asks
// for it or the user chose it. `i18n.t` is the current message set.

import { browser } from '$app/env';
import { cs } from './cs.js';
import { en, type Messages } from './en.js';

export const locales = { en, cs } as const;
export type Locale = keyof typeof locales;

const KEY = 'puptrainer.locale';

function initial(): Locale {
	if (!browser) return 'en';
	const stored = localStorage.getItem(KEY);
	if (stored && stored in locales) return stored as Locale;
	return navigator.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

class I18n {
	locale = $state<Locale>(initial());

	get t(): Messages {
		return locales[this.locale];
	}

	set(locale: Locale) {
		this.locale = locale;
		if (!browser) return;
		localStorage.setItem(KEY, locale);
		document.documentElement.lang = locale;
	}

	/** A text of the content (titles, instructions) in the current language, English otherwise. */
	pick(texts: Record<string, string> | undefined): string {
		return texts?.[this.locale] ?? texts?.en ?? '';
	}

	/** The name of a spoken language, or its code when unknown. */
	language(code: string | null | undefined): string {
		if (!code) return this.t.common.anyLanguage;
		return this.t.languages[code] ?? code;
	}
}

export const i18n = new I18n();
