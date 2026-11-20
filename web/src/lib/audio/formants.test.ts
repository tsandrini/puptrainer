import { describe, expect, it } from 'vitest';
import {
	MIN_FRAMES,
	ResonanceTracker,
	brightnessPct,
	burg,
	firstPct,
	formantsOf,
	measureTake,
	resample,
	roots,
	type Formants
} from './formants.js';

const TUBE: Formants = [500, 1500, 2500, 3500];

/** The resonances of a tube: the given ones, continued upwards at their last spacing. */
function tube(formants: readonly number[]): number[] {
	const all = [...formants];
	const step = all[all.length - 1] - all[all.length - 2];
	while (all[all.length - 1] + step < 20000) all.push(all[all.length - 1] + step);
	return all;
}

/** A synthetic vowel: harmonics of `f0`, falling by 6 dB an octave, shaped by resonances. */
function vowel(formants: readonly number[], f0 = 120, seconds = 1.2, rate = 48000): Float32Array {
	const out = new Float32Array(Math.round(seconds * rate));
	const resonances = tube(formants);
	let peak = 0;
	for (let k = 1; k * f0 < 8000; k++) {
		const f = k * f0;
		let gain = 1 / k;
		for (const centre of resonances) {
			const width = 80 + 0.02 * centre;
			gain /= Math.sqrt((1 - (f / centre) ** 2) ** 2 + ((f * width) / centre ** 2) ** 2);
		}
		for (let i = 0; i < out.length; i++)
			out[i] += gain * Math.sin((2 * Math.PI * f * i) / rate + 1.7 * k);
	}
	for (const v of out) peak = Math.max(peak, Math.abs(v));
	return out.map((v) => (0.3 * v) / peak);
}

/** A synthetic whisper: noise through the same resonances. */
function whisper(formants: readonly number[], seconds = 1.2, rate = 48000): Float32Array {
	let state = 12345;
	const noise = () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x40000000 - 1;
	};
	let x = Float64Array.from({ length: Math.round(seconds * rate) }, noise);
	for (const centre of tube(formants).filter((f) => f < 9000)) {
		const r = Math.exp((-Math.PI * (80 + 0.02 * centre)) / rate);
		const c = 2 * r * Math.cos((2 * Math.PI * centre) / rate);
		const y = new Float64Array(x.length);
		for (let i = 0; i < x.length; i++)
			y[i] = x[i] + c * (i > 0 ? y[i - 1] : 0) - r * r * (i > 1 ? y[i - 2] : 0);
		x = y;
	}
	const peak = x.reduce((top, v) => Math.max(top, Math.abs(v)), 0);
	return Float32Array.from(x, (v) => (0.3 * v) / peak);
}

const scaled = (factor: number): Formants => TUBE.map((f) => f * factor) as Formants;

describe('linear prediction', () => {
	it('resamples below the new Nyquist frequency without moving a tone', () => {
		const rate = 48000;
		const low = Float32Array.from({ length: 2400 }, (_, i) =>
			Math.sin((2 * Math.PI * 1000 * i) / rate)
		);
		const high = Float32Array.from({ length: 2400 }, (_, i) =>
			Math.sin((2 * Math.PI * 9000 * i) / rate)
		);
		const kept = resample(low, rate, 11000);
		expect(kept.length).toBe(550);
		// 1 kHz at 11 kHz: a zero crossing every 5.5 samples
		let crossings = 0;
		for (let i = 101; i < 450; i++) if (kept[i - 1] < 0 !== kept[i] < 0) crossings++;
		expect(crossings).toBeGreaterThanOrEqual(62);
		expect(crossings).toBeLessThanOrEqual(65);
		const rms = (x: Float64Array) =>
			Math.sqrt(x.subarray(100, 450).reduce((sum, v) => sum + v * v, 0) / 350);
		expect(rms(kept)).toBeCloseTo(Math.SQRT1_2, 1);
		expect(rms(resample(high, rate, 11000))).toBeLessThan(0.01);
	});

	it('finds the pole of a resonator driven by noise', () => {
		// x[n] = e[n] + 2r·cos(w)·x[n-1] - r²·x[n-2]: poles at r·exp(±iw)
		const [r, w] = [0.97, 0.6];
		let state = 99;
		const x = new Float64Array(8000);
		for (let n = 0; n < x.length; n++) {
			state = (state * 1103515245 + 12345) & 0x7fffffff;
			const e = state / 0x40000000 - 1;
			x[n] = e + 2 * r * Math.cos(w) * (n > 0 ? x[n - 1] : 0) - r * r * (n > 1 ? x[n - 2] : 0);
		}
		const a = burg(x, 2);
		expect(a[1]).toBeCloseTo(-2 * r * Math.cos(w), 1);
		expect(a[2]).toBeCloseTo(r * r, 1);
		const { re, im } = roots(a);
		expect(Math.hypot(re[0], im[0])).toBeCloseTo(r, 1);
		expect(Math.abs(Math.atan2(im[0], re[0]))).toBeCloseTo(w, 1);
	});

	it('finds the roots of a polynomial', () => {
		// (z - 1)(z + 2)(z - 3) = z³ - 2z² - 5z + 6
		const { re, im } = roots(Float64Array.from([1, -2, -5, 6]));
		expect([...re].sort((a, b) => a - b).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-2, 1, 3]);
		expect(Math.max(...im.map(Math.abs))).toBeLessThan(1e-6);
	});
});

describe('formants of a frame', () => {
	it.each([
		[TUBE, 120, 48000],
		[scaled(1.15), 200, 48000],
		[TUBE, 160, 44100]
	] as const)('reads the resonances of a synthetic vowel', (formants, f0, rate) => {
		const sound = vowel(formants, f0, 0.3, rate);
		const middle = sound.subarray(Math.round(0.1 * rate), Math.round(0.15 * rate));
		const found = formantsOf(middle, rate);
		expect(found).not.toBeNull();
		found!.forEach((hz, index) => {
			expect(Math.abs(hz / formants[index] - 1)).toBeLessThan(0.08);
		});
	});

	it('has nothing to say about silence', () => {
		expect(formantsOf(new Float32Array(2400), 48000)).toBeNull();
	});
});

describe('resonance of a stream', () => {
	it('reads a brighter voice as brighter by about as much', () => {
		const everyday = measureTake(vowel(TUBE, 150), 48000);
		const bright = measureTake(vowel(scaled(1.1), 150), 48000);
		expect(everyday).not.toBeNull();
		expect(bright).not.toBeNull();
		expect(brightnessPct(bright!, everyday!)).toBeGreaterThan(8);
		expect(brightnessPct(bright!, everyday!)).toBeLessThan(12);
		// F1 sits among the lowest harmonics, which pull at it: a looser reading
		expect(firstPct(bright!, everyday!)).toBeGreaterThan(4);
		expect(firstPct(bright!, everyday!)).toBeLessThan(16);
		expect(brightnessPct(everyday!, everyday!)).toBe(0);
	});

	it('leaves out what it cannot measure: silence, a squeak, the wrong kind of sound', () => {
		expect(measureTake(new Float32Array(48000), 48000)).toBeNull();
		// above 300 Hz the harmonics lie too far apart
		expect(measureTake(vowel(TUBE, 420), 48000)).toBeNull();
		// a voice is not a whisper, and a whisper is not a voice
		expect(measureTake(vowel(TUBE, 150), 48000, 'whisper')).toBeNull();
		expect(measureTake(whisper(TUBE), 48000, 'voiced')).toBeNull();
	});

	it('follows a whisper, which has no pitch', () => {
		const big = measureTake(whisper(TUBE), 48000, 'whisper');
		const small = measureTake(whisper(scaled(1.12)), 48000, 'whisper');
		expect(big).not.toBeNull();
		expect(small).not.toBeNull();
		expect(brightnessPct(small!, big!)).toBeGreaterThan(9);
		expect(brightnessPct(small!, big!)).toBeLessThan(15);
	});

	it('reads the last seconds against the start of the take', () => {
		const tracker = new ResonanceTracker('voiced');
		const feed = (sound: Float32Array) => {
			for (let at = 0; at + 2048 <= sound.length; at += 2048)
				tracker.push(sound.subarray(at, at + 2048), 48000, 150);
		};
		expect(tracker.recent(2)).toBeNull();
		feed(vowel(TUBE, 150, 0.5));
		expect(tracker.opening(1)).toBeNull();
		feed(vowel(TUBE, 150, 1.2));
		const zero = tracker.opening(1);
		expect(zero).not.toBeNull();
		expect(tracker.heard).toBeGreaterThan(1.2);
		feed(vowel(scaled(1.1), 150, 2.5));
		const now = tracker.recent(1.5);
		expect(now).not.toBeNull();
		expect(brightnessPct(now!, zero!)).toBeGreaterThan(8);
		expect(brightnessPct(now!, zero!)).toBeLessThan(12);
		// the zero stays where the take began
		expect(tracker.opening(1)).toEqual(zero);
		// a pause empties the recent window, not the take
		for (let i = 0; i < 80; i++) tracker.push(new Float32Array(2048), 48000, null);
		expect(tracker.recent(1.5)).toBeNull();
		expect(tracker.whole()).not.toBeNull();
		expect(MIN_FRAMES).toBeGreaterThan(5);
	});
});
