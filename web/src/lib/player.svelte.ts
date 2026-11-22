// The app's player: one take sounding from the dock at the bottom of every
// page, with the list it came from to walk through. Any page hands it a
// take (and the takes around it); the dock draws it and owns the element.
import { browser } from '$app/env';
import { takeAudioUrl } from '#lib/api/index.js';
import type { TakeOut } from '#lib/api/types.js';
import { claimSound, releaseSound } from '#lib/audio/focus.js';

const OWNER = Symbol('dock');
const KEY = 'puptrainer.player';
export const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

type Kept = { rate: number; loop: boolean; onward: boolean };

function kept(): Kept {
	const fallback = { rate: 1, loop: false, onward: false };
	if (!browser) return fallback;
	try {
		return { ...fallback, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Kept>) };
	} catch {
		return fallback;
	}
}

class Player {
	/** The takes "next" and "previous" walk through, in the order of where they came from. */
	queue = $state.raw<TakeOut[]>([]);
	index = $state(-1);
	playing = $state(false);
	/** Seconds into the take. */
	position = $state(0);
	duration = $state(0);
	rate = $state(kept().rate);
	/** Play the take again when it ends. */
	loop = $state(kept().loop);
	/** Go on to the next take of the list when one ends. */
	onward = $state(kept().onward);
	/** Why the take does not sound: the browser wants a click first, or the recording failed. */
	problem = $state<'blocked' | 'failed' | null>(null);
	#audio: HTMLAudioElement | null = null;

	get take(): TakeOut | null {
		return this.queue[this.index] ?? null;
	}

	/** The dock hands over its element (or takes it away). */
	attach(audio: HTMLAudioElement | null): void {
		this.#audio = audio;
	}

	/** Whether this take is the one in the dock. */
	holds(id: string | null | undefined): boolean {
		return id != null && this.take?.id === id;
	}

	/** Whether this take is sounding right now. */
	sounds(id: string | null | undefined): boolean {
		return this.playing && this.holds(id);
	}

	/**
	 * Play a take from its start.
	 *
	 * @param take The take to hear.
	 * @param queue The takes around it, in the order to walk through; the take alone without.
	 */
	play(take: TakeOut, queue: TakeOut[] = [take]): void {
		const at = queue.findIndex((t) => t.id === take.id);
		this.queue = at < 0 ? [take] : queue;
		this.index = Math.max(at, 0);
		this.#start();
	}

	/** A play button of a take: pause it when it sounds, go on when it is in the dock, else play it. */
	toggle(take: TakeOut, queue?: TakeOut[]): void {
		if (!this.holds(take.id)) this.play(take, queue);
		else if (this.playing) this.pause();
		else this.resume();
	}

	pause(): void {
		this.#audio?.pause();
	}

	resume(): void {
		const audio = this.#audio;
		if (!audio || !this.take) return;
		if (audio.ended) audio.currentTime = 0;
		this.#sound(audio);
	}

	/** Go to a moment of the take, in seconds. */
	seek(seconds: number): void {
		const audio = this.#audio;
		if (!audio || !this.take) return;
		const to = Math.min(Math.max(seconds, 0), this.duration || this.take.duration_s);
		audio.currentTime = to;
		this.position = to;
	}

	/** Step through the list; `false` at its end. */
	step(by: 1 | -1): boolean {
		const to = this.index + by;
		if (to < 0 || to >= this.queue.length) return false;
		this.index = to;
		this.#start();
		return true;
	}

	setRate(rate: number): void {
		this.rate = rate;
		if (this.#audio) this.#audio.playbackRate = rate;
		this.#keep();
	}

	setLoop(on: boolean): void {
		this.loop = on;
		this.#keep();
	}

	setOnward(on: boolean): void {
		this.onward = on;
		this.#keep();
	}

	/** The take ended: again, onward, or done. */
	ended(): void {
		if (this.loop) this.resume();
		else if (!this.onward || !this.step(1)) this.playing = false;
	}

	/** Empty the dock. */
	close(): void {
		this.pause();
		releaseSound(OWNER);
		this.queue = [];
		this.index = -1;
		this.position = 0;
		this.duration = 0;
		this.problem = null;
	}

	/** A take was changed or deleted elsewhere: keep the list honest. */
	forget(id: string): void {
		if (!this.queue.some((t) => t.id === id)) return;
		if (this.holds(id)) return this.close();
		const current = this.take;
		this.queue = this.queue.filter((t) => t.id !== id);
		this.index = current ? this.queue.findIndex((t) => t.id === current.id) : -1;
	}

	#start(): void {
		const [audio, take] = [this.#audio, this.take];
		if (!audio || !take) return;
		if (audio.dataset.take !== take.id) {
			audio.src = takeAudioUrl(take.id);
			audio.dataset.take = take.id;
			this.duration = take.duration_s;
		}
		audio.currentTime = 0;
		this.position = 0;
		this.#sound(audio);
	}

	#sound(audio: HTMLAudioElement): void {
		audio.playbackRate = this.rate;
		claimSound(OWNER, () => audio.pause());
		audio
			.play()
			.then(() => (this.problem = null))
			.catch((error: unknown) => {
				const name = error instanceof DOMException ? error.name : '';
				// NOTE: a pause or the next take ends a play that was starting: not a failure
				if (name === 'AbortError') return;
				this.problem = name === 'NotAllowedError' ? 'blocked' : 'failed';
				this.playing = false;
			});
	}

	#keep(): void {
		if (!browser) return;
		const value: Kept = { rate: this.rate, loop: this.loop, onward: this.onward };
		localStorage.setItem(KEY, JSON.stringify(value));
	}
}

export const player = new Player();
