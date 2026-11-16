// The installed app: the service worker (the app shell offline) and the
// browser's deferred install prompt.

import { browser, dev } from '$app/env';

/** Chromium's deferred install prompt. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

class Pwa {
	installPrompt = $state<InstallPrompt | null>(null);

	get installed(): boolean {
		return browser && matchMedia('(display-mode: standalone)').matches;
	}

	/** Captures the install prompt and registers the worker (built app only). */
	async start(): Promise<void> {
		addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			this.installPrompt = event as InstallPrompt;
		});
		if (dev || !('serviceWorker' in navigator)) return;
		try {
			await navigator.serviceWorker.register('/service-worker.js');
		} catch (e) {
			console.warn('service worker:', e);
		}
	}

	async install(): Promise<void> {
		if (!this.installPrompt) return;
		await this.installPrompt.prompt();
		await this.installPrompt.userChoice;
		this.installPrompt = null;
	}
}

export const pwa = new Pwa();
