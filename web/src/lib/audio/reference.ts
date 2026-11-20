// The everyday voice as the live meter measures it. A live resonance is
// counted from the learner's everyday takes, measured in the browser by the
// same method as the microphone's sound, so that the two can be compared.
// Each take is measured once and remembered on this device.

import { api } from '#lib/api/client.js';
import { fetchReference } from '#lib/api/index.js';
import type { Basis } from '#lib/api/types.js';
import { BLOCK, ResonanceTracker, type Formants } from './formants.js';
import { detectPitch } from './pitch.js';

/** Raised when the live method changes: what was remembered under another number is redone. */
const METHOD = 1;
/** The rate takes are decoded at, as the player does. */
const RATE = 48000;
/** Blocks measured before the page gets a turn again: about a second of sound. */
const BREATH = 24;

/** The everyday voice for the live meter: its formants, and what they were measured on. */
export type LiveReference = { formants: Formants; basis: Basis; takes: number };

const key = (takeId: string) => `puptrainer.live.${METHOD}.${takeId}`;
const measuring = new Map<string, Promise<Formants | null>>();

/** Measures one stored take as the live meter would, without holding up the page. */
async function measure(takeId: string): Promise<Formants | null> {
	const bytes = await (await api(`takes/${encodeURIComponent(takeId)}/audio`)).arrayBuffer();
	const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes);
	const samples = decoded.getChannelData(0);
	const tracker = new ResonanceTracker('voiced');
	for (let start = 0, count = 1; start + BLOCK <= samples.length; start += BLOCK, count++) {
		const block = samples.subarray(start, start + BLOCK);
		tracker.push(block, RATE, detectPitch(block, RATE)?.hz ?? null);
		if (count % BREATH === 0) await new Promise((resolve) => setTimeout(resolve));
	}
	return tracker.whole();
}

/** The formants of a stored take by the live method; remembered once measured. */
function measured(takeId: string): Promise<Formants | null> {
	const stored = localStorage.getItem(key(takeId));
	if (stored !== null) return Promise.resolve(JSON.parse(stored) as Formants | null);
	let running = measuring.get(takeId);
	if (!running) {
		running = measure(takeId)
			.then((formants) => {
				localStorage.setItem(key(takeId), JSON.stringify(formants));
				return formants;
			})
			.finally(() => measuring.delete(takeId));
		measuring.set(takeId, running);
	}
	return running;
}

/**
 * The everyday voice to count a live resonance of this kind of take from.
 *
 * @param kind the microphone setup and what is about to be recorded
 * @returns the geometric mean of the everyday takes' formants by the live method, or null
 *   when there is no everyday speech to count from
 * @throws when the API or a recording cannot be reached or decoded
 */
export async function liveReference(kind: {
	device_id: number;
	item: string;
	language?: string | null;
	content_ref?: string | null;
}): Promise<LiveReference | null> {
	const voice = await fetchReference(kind);
	if (!voice || voice.basis === 'vowels') return null;
	const found: Formants[] = [];
	for (const takeId of voice.take_ids) {
		const formants = await measured(takeId);
		if (formants) found.push(formants);
	}
	if (!found.length) return null;
	const mean = (index: number) =>
		Math.exp(found.reduce((sum, formants) => sum + Math.log(formants[index]), 0) / found.length);
	return {
		formants: [mean(0), mean(1), mean(2), mean(3)],
		basis: voice.basis,
		takes: found.length
	};
}
