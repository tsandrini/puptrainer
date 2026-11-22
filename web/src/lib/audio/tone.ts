// A reference note for the note-matching drill: a soft tone with a few
// harmonics (a pure sine is faint on small speakers), faded in and out.
// It is played before recording starts, never during: the recorder's echo
// cancellation is off, so a tone from the speakers would be recorded.

import { hush } from './focus.js';

/** Relative amplitudes of the first harmonics. */
const HARMONICS = [1, 0.5, 0.25, 0.12];
const FADE_S = 0.04;

/** A pitch pattern: moments (seconds from the start) with the pitch reached at each. */
export type Shape = [seconds: number, hz: number][];

/**
 * The pitch pattern of an exercise, placed around a band.
 *
 * @param demo which pattern (`slide-down`: from well above the band into its lower half
 *   and held; `glide`: from below the band to above it and back)
 * @param low lower edge of the band, Hz
 * @param high upper edge, Hz
 * @returns the pattern, or null when the exercise has none
 */
export function shapeOf(demo: string, low: number, high: number): Shape | null {
	const rest = low * 2 ** (1.5 / 12);
	if (demo === 'slide-down')
		return [
			[0, high * 1.6],
			[0.6, high * 1.6],
			[2.2, rest],
			[4.7, rest]
		];
	if (demo === 'glide')
		return [
			[0, low / 1.5],
			[3, high * 1.5],
			[6, low / 1.5]
		];
	return null;
}

/**
 * Plays a pitch pattern as one gliding tone.
 *
 * @param shape the pattern; the pitch moves smoothly between its moments
 * @param volume peak gain, 0..1
 * @returns when it has finished
 */
export async function playShape(shape: Shape, volume = 0.25): Promise<void> {
	hush();
	const context = new AudioContext();
	try {
		const real = new Float32Array([0, ...HARMONICS]);
		const oscillator = context.createOscillator();
		oscillator.setPeriodicWave(context.createPeriodicWave(real, new Float32Array(real.length)));
		const gain = context.createGain();
		const start = context.currentTime + 0.02;
		const length = shape.at(-1)![0];
		oscillator.frequency.setValueAtTime(shape[0][1], start);
		for (const [seconds, hz] of shape.slice(1))
			oscillator.frequency.exponentialRampToValueAtTime(hz, start + seconds);
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(volume, start + FADE_S);
		gain.gain.setValueAtTime(volume, start + length - FADE_S);
		gain.gain.linearRampToValueAtTime(0, start + length);
		oscillator.connect(gain).connect(context.destination);
		const ended = new Promise<void>((resolve) => (oscillator.onended = () => resolve()));
		oscillator.start(start);
		oscillator.stop(start + length);
		await ended;
	} finally {
		await context.close();
	}
}

/**
 * Plays a note.
 *
 * @param hz its pitch
 * @param seconds how long it sounds
 * @param volume peak gain, 0..1
 * @returns when it has finished
 */
export async function playTone(hz: number, seconds = 1.5, volume = 0.25): Promise<void> {
	hush();
	const context = new AudioContext();
	try {
		const real = new Float32Array([0, ...HARMONICS]);
		const wave = context.createPeriodicWave(real, new Float32Array(real.length));
		const oscillator = context.createOscillator();
		oscillator.setPeriodicWave(wave);
		oscillator.frequency.value = hz;
		const gain = context.createGain();
		const start = context.currentTime + 0.02;
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(volume, start + FADE_S);
		gain.gain.setValueAtTime(volume, start + seconds - FADE_S);
		gain.gain.linearRampToValueAtTime(0, start + seconds);
		oscillator.connect(gain).connect(context.destination);
		const ended = new Promise<void>((resolve) => (oscillator.onended = () => resolve()));
		oscillator.start(start);
		oscillator.stop(start + seconds);
		await ended;
	} finally {
		await context.close();
	}
}
