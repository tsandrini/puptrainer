// Which spectrogram the player and the live view draw: the voice's
// harmonics (a long window) or its resonances (a short one). One choice
// for every picture on the page, kept in localStorage.

import { browser } from '$app/env';
import type { View } from './spectrum.js';

const KEY = 'puptrainer.spectrum';

class SpectrumView {
	value = $state<View>(
		browser && localStorage.getItem(KEY) === 'formants' ? 'formants' : 'harmonics'
	);

	set(view: View): void {
		this.value = view;
		if (browser) localStorage.setItem(KEY, view);
	}
}

export const spectrumView = new SpectrumView();

/** The layout every spectrogram of the app shares, in picture rows. */
export const LAYOUT = { rows: 160, gap: 3, levelRows: 34 } as const;
