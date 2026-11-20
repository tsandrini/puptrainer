// Live resonances for the recording screen: linear prediction (Burg's
// method) on short frames of the microphone's sound, the way the backend's
// analysis finds formants, and medians over the last seconds. A guide while
// speaking; the stored numbers come from the backend's pipeline, which fits
// its analysis range to each take and so reads a brighter voice as brighter
// still (on real takes about 7% where this reads 4%). Plain functions and
// classes, no browser APIs.

import { detectPitch } from './pitch.js';

/** F1 to F4, in Hz. */
export type Formants = [number, number, number, number];

/** Which frames count: a voice below 300 Hz, or sound without a pitch (a whisper). */
export type Mode = 'voiced' | 'whisper';

/** Five formants are looked for below this frequency. */
export const CEILING_HZ = 5500;
/** Above this pitch the harmonics lie too far apart to show the resonances. */
export const MAX_PITCH_HZ = 300;
/** Length of one analysed frame, and the step between frames. */
export const FRAME_S = 0.05;
export const HOP_S = 0.02;
/**
 * Frames this far below the loudest recent one are left out: consonants and pauses.
 * The backend keeps the louder 40% of a take's voiced frames; this is the same idea
 * for a stream whose end is not known yet.
 */
const GATE_DB = 6;
/** How fast the memory of the loudest frame fades, per frame (2.5 dB a second). */
const FADE_DB = 0.05;
const SILENCE_DB = -55;
/** Two poles per formant. */
const ORDER = 10;
const PREEMPHASIS_HZ = 50;
/** Zero crossings of the resampling kernel either side of its middle. */
const KERNEL_ZEROS = 6;
/** How much of the stream is kept for `recent`. */
const KEEP_S = 30;
/** The fewest frames a median is taken over. */
export const MIN_FRAMES = 12;
/** The block size the recorder hands over; a whole take is cut the same way. */
export const BLOCK = 2048;

/**
 * Resamples a frame to `target` samples per second with a windowed-sinc low-pass.
 *
 * @param input the frame
 * @param rate its sample rate
 * @param target the wanted rate, below `rate`
 * @returns the frame at the new rate
 */
export function resample(input: Float32Array, rate: number, target: number): Float64Array {
	const step = rate / target;
	const cutoff = (0.45 * target) / rate; // cycles per input sample
	const half = KERNEL_ZEROS / (2 * cutoff);
	const out = new Float64Array(Math.floor((input.length - 1) / step) + 1);
	for (let k = 0; k < out.length; k++) {
		const at = k * step;
		const from = Math.max(0, Math.ceil(at - half));
		const to = Math.min(input.length - 1, Math.floor(at + half));
		let sum = 0;
		for (let n = from; n <= to; n++) {
			const t = at - n;
			const x = 2 * Math.PI * cutoff * t;
			const sinc = x === 0 ? 1 : Math.sin(x) / x;
			sum += input[n] * 2 * cutoff * sinc * (0.5 + 0.5 * Math.cos((Math.PI * t) / half));
		}
		out[k] = sum;
	}
	return out;
}

/**
 * Burg's linear prediction.
 *
 * @param x the frame
 * @param order number of poles
 * @returns `order + 1` coefficients of A(z) = 1 + a1/z + … + ap/z^p
 */
export function burg(x: Float64Array, order: number): Float64Array {
	const n = x.length;
	const forward = Float64Array.from(x);
	const backward = Float64Array.from(x);
	let a = new Float64Array(order + 1);
	a[0] = 1;
	for (let m = 1; m <= order; m++) {
		let num = 0;
		let den = 0;
		for (let i = m; i < n; i++) {
			num += forward[i] * backward[i - 1];
			den += forward[i] * forward[i] + backward[i - 1] * backward[i - 1];
		}
		const k = den > 0 ? (-2 * num) / den : 0;
		const next = a.slice();
		for (let i = 1; i <= m; i++) next[i] = a[i] + k * a[m - i];
		a = next;
		for (let i = n - 1; i >= m; i--) {
			const f = forward[i];
			forward[i] = f + k * backward[i - 1];
			backward[i] = backward[i - 1] + k * f;
		}
	}
	return a;
}

/**
 * The roots of z^p + a1·z^(p-1) + … + ap, by the Durand–Kerner iteration.
 *
 * @param a the coefficients, `a[0]` being 1
 * @returns real and imaginary parts of the `a.length - 1` roots
 */
export function roots(a: Float64Array): { re: Float64Array; im: Float64Array } {
	const p = a.length - 1;
	const re = new Float64Array(p);
	const im = new Float64Array(p);
	// NOTE: the usual start, powers of a number that is neither real nor on the unit circle
	let [sr, si] = [1, 0];
	for (let j = 0; j < p; j++) {
		re[j] = sr;
		im[j] = si;
		[sr, si] = [sr * 0.4 - si * 0.9, sr * 0.9 + si * 0.4];
	}
	for (let round = 0; round < 200; round++) {
		let moved = 0;
		for (let j = 0; j < p; j++) {
			// the polynomial at root j, by Horner's rule
			let [vr, vi] = [1, 0];
			for (let c = 1; c <= p; c++)
				[vr, vi] = [vr * re[j] - vi * im[j] + a[c], vr * im[j] + vi * re[j]];
			// the product of its distances to the other roots
			let [dr, di] = [1, 0];
			for (let other = 0; other < p; other++) {
				if (other === j) continue;
				const [er, ei] = [re[j] - re[other], im[j] - im[other]];
				[dr, di] = [dr * er - di * ei, dr * ei + di * er];
			}
			const size = dr * dr + di * di;
			if (size === 0) continue;
			const [qr, qi] = [(vr * dr + vi * di) / size, (vi * dr - vr * di) / size];
			re[j] -= qr;
			im[j] -= qi;
			moved = Math.max(moved, Math.abs(qr) + Math.abs(qi));
		}
		if (moved < 1e-10) break;
	}
	return { re, im };
}

/**
 * The first four formants of one frame of sound.
 *
 * The frame is resampled to twice the ceiling, pre-emphasised from 50 Hz and windowed
 * (a Gaussian, as Praat's); the angles of the prediction polynomial's roots are the
 * resonances.
 *
 * @param frame about 50 ms of sound
 * @param sampleRate its sample rate
 * @param ceilingHz five formants are looked for below this
 * @returns F1 to F4, or null when the frame does not show four
 */
export function formantsOf(
	frame: Float32Array,
	sampleRate: number,
	ceilingHz = CEILING_HZ
): Formants | null {
	const rate = 2 * ceilingHz;
	const x = sampleRate > rate ? resample(frame, sampleRate, rate) : Float64Array.from(frame);
	const used = sampleRate > rate ? rate : sampleRate;
	const n = x.length;
	if (n <= 2 * ORDER || !x.some((v) => v !== 0)) return null;
	const emphasis = Math.exp((-2 * Math.PI * PREEMPHASIS_HZ) / used);
	for (let i = n - 1; i > 0; i--) x[i] -= emphasis * x[i - 1];
	const edge = Math.exp(-12);
	for (let i = 0; i < n; i++) {
		const t = (i - (n - 1) / 2) / (n + 1);
		x[i] *= (Math.exp(-48 * t * t) - edge) / (1 - edge);
	}
	const { re, im } = roots(burg(x, ORDER));
	const found: number[] = [];
	for (let j = 0; j < re.length; j++) {
		if (im[j] <= 0) continue;
		const hz = (Math.atan2(im[j], re[j]) * used) / (2 * Math.PI);
		if (hz > 50 && hz < used / 2 - 50) found.push(hz);
	}
	if (found.length < 4) return null;
	found.sort((a, b) => a - b);
	return [found[0], found[1], found[2], found[3]];
}

/** The median of each formant over some frames. */
function medians(frames: Formants[]): Formants {
	const middle = (index: number) => {
		const values = frames.map((f) => f[index]).sort((a, b) => a - b);
		const half = values.length >> 1;
		return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
	};
	return [middle(0), middle(1), middle(2), middle(3)];
}

/** How much higher F2 to F4 sit than in `zero`, in percent (their geometric mean). */
export const brightnessPct = (now: Formants, zero: Formants) =>
	100 * (Math.cbrt((now[1] / zero[1]) * (now[2] / zero[2]) * (now[3] / zero[3])) - 1);

/** How much higher F1 sits than in `zero`, in percent. */
export const firstPct = (now: Formants, zero: Formants) => 100 * (now[0] / zero[0] - 1);

/** The resonances of a running stream: the frames that count, and medians over them. */
export class ResonanceTracker {
	#rate = 0;
	#frame = 0;
	#hop = 0;
	#buffer = new Float32Array(0);
	#filled = 0;
	#seconds = 0;
	#loudest = -120;
	#frames: { at: number; formants: Formants }[] = [];
	#opening: Formants[] = [];
	#count = 0;

	/** @param mode which frames count */
	constructor(readonly mode: Mode = 'voiced') {}

	/** Seconds of sound that counted so far. */
	get heard(): number {
		return this.#count * HOP_S;
	}

	/**
	 * Takes in the next block of the stream.
	 *
	 * @param block samples in [-1, 1]
	 * @param sampleRate samples per second
	 * @param pitchHz the block's pitch, or null when it has none
	 */
	push(block: Float32Array, sampleRate: number, pitchHz: number | null): void {
		if (sampleRate !== this.#rate) {
			this.#rate = sampleRate;
			this.#frame = Math.round(FRAME_S * sampleRate);
			this.#hop = Math.round(HOP_S * sampleRate);
			this.#buffer = new Float32Array(this.#frame + Math.max(BLOCK, block.length));
			this.#filled = 0;
		}
		if (this.#filled + block.length > this.#buffer.length) {
			const grown = new Float32Array(this.#filled + block.length);
			grown.set(this.#buffer.subarray(0, this.#filled));
			this.#buffer = grown;
		}
		this.#buffer.set(block, this.#filled);
		this.#filled += block.length;
		const wanted =
			this.mode === 'whisper' ? pitchHz === null : pitchHz !== null && pitchHz <= MAX_PITCH_HZ;
		let start = 0;
		for (; start + this.#frame <= this.#filled; start += this.#hop) {
			const frame = this.#buffer.subarray(start, start + this.#frame);
			let sum = 0;
			for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
			const db = sum > 0 ? 10 * Math.log10(sum / frame.length) : -120;
			this.#loudest = Math.max(db, this.#loudest - FADE_DB);
			this.#seconds += HOP_S;
			if (!wanted || db < Math.max(SILENCE_DB, this.#loudest - GATE_DB)) continue;
			const formants = formantsOf(frame, sampleRate);
			if (!formants) continue;
			this.#frames.push({ at: this.#seconds, formants });
			this.#opening.push(formants);
			this.#count++;
		}
		this.#buffer.copyWithin(0, start, this.#filled);
		this.#filled -= start;
		const oldest = this.#seconds - KEEP_S;
		while (this.#frames.length && this.#frames[0].at < oldest) this.#frames.shift();
	}

	/**
	 * The median formants over the last `seconds` of the stream.
	 *
	 * @returns null while fewer than `MIN_FRAMES` frames of it counted
	 */
	recent(seconds: number): Formants | null {
		const since = this.#seconds - seconds;
		const frames = this.#frames.filter((f) => f.at > since).map((f) => f.formants);
		return frames.length < MIN_FRAMES ? null : medians(frames);
	}

	/**
	 * The median formants of the first `seconds` of sound that counted: the zero of a
	 * take read against its own start.
	 *
	 * @returns null until that much has been heard
	 */
	opening(seconds: number): Formants | null {
		const frames = Math.round(seconds / HOP_S);
		return this.#opening.length < frames ? null : medians(this.#opening.slice(0, frames));
	}

	/** The median formants over everything that counted; null with too few frames. */
	whole(): Formants | null {
		return this.#opening.length < MIN_FRAMES ? null : medians(this.#opening);
	}
}

/**
 * The resonances of a whole take, measured as the live view measures them, so a live
 * reading and its reference come from the same method.
 *
 * @param samples the take
 * @param sampleRate its sample rate
 * @param mode which frames count
 * @returns the median F1 to F4 over the frames that count, or null with too few
 */
export function measureTake(
	samples: Float32Array,
	sampleRate: number,
	mode: Mode = 'voiced'
): Formants | null {
	const tracker = new ResonanceTracker(mode);
	for (let start = 0; start + BLOCK <= samples.length; start += BLOCK) {
		const block = samples.subarray(start, start + BLOCK);
		tracker.push(block, sampleRate, detectPitch(block, sampleRate)?.hz ?? null);
	}
	return tracker.whole();
}
