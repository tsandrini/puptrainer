// Spectrograms for the player and the live view while recording: a
// windowed FFT, its power mapped to frequency rows, columns for a whole
// take or a running stream, and pixels in the theme's ramp. A picture to
// look at while recording and listening; the stored numbers come from the
// backend's pipeline. Plain functions and classes, no browser APIs.

import { levelOf } from './meter.js';

/**
 * Which detail the spectrogram resolves: a long window separates the voice's harmonics
 * (narrowband), a short one shows its resonances as bands (wideband).
 */
export type View = 'harmonics' | 'formants';

/** Window length per view, in seconds. */
export const WINDOW_S: Record<View, number> = { harmonics: 0.046, formants: 0.006 };
/** Top of the frequency axis. */
export const MAX_HZ = 5000;
/** How far below the loudest point the ramp reaches. */
export const RANGE_DB = 65;
/** The loudest point is never taken to be quieter than this, so silence stays dark. */
export const MIN_TOP_DB = -50;
/** Samples between the live view's columns. */
export const LIVE_HOP = 512;
/** The quietest power reported, in dB. */
const FLOOR_DB = -140;

/** A Hann window of `n` samples. */
export function hann(n: number): Float32Array {
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
	return out;
}

/** An in-place radix-2 FFT of a fixed size. */
export class FFT {
	#cos: Float32Array;
	#sin: Float32Array;
	#reverse: Uint32Array;

	/**
	 * @param size the transform's length, a power of two
	 * @throws RangeError when `size` is not a power of two
	 */
	constructor(readonly size: number) {
		if (size < 2 || (size & (size - 1)) !== 0) throw new RangeError('size must be a power of two');
		this.#cos = new Float32Array(size / 2);
		this.#sin = new Float32Array(size / 2);
		for (let i = 0; i < size / 2; i++) {
			this.#cos[i] = Math.cos((2 * Math.PI * i) / size);
			this.#sin[i] = Math.sin((2 * Math.PI * i) / size);
		}
		const bits = Math.log2(size);
		this.#reverse = new Uint32Array(size);
		for (let i = 0; i < size; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
			this.#reverse[i] = r;
		}
	}

	/** Transforms `re` and `im` (each `size` long) in place. */
	transform(re: Float32Array, im: Float32Array): void {
		const n = this.size;
		for (let i = 0; i < n; i++) {
			const j = this.#reverse[i];
			if (j > i) {
				[re[i], re[j]] = [re[j], re[i]];
				[im[i], im[j]] = [im[j], im[i]];
			}
		}
		for (let half = 1; half < n; half *= 2) {
			const step = n / (2 * half);
			for (let start = 0; start < n; start += 2 * half) {
				for (let k = 0; k < half; k++) {
					const c = this.#cos[k * step];
					const s = this.#sin[k * step];
					const a = start + k;
					const b = a + half;
					const tr = re[b] * c + im[b] * s;
					const ti = im[b] * c - re[b] * s;
					re[b] = re[a] - tr;
					im[b] = im[a] - ti;
					re[a] += tr;
					im[a] += ti;
				}
			}
		}
	}
}

/** Power over frequency rows of one window of sound, for one view at one sample rate. */
export class Analyser {
	readonly windowSize: number;
	readonly fftSize: number;
	#fft: FFT;
	#window: Float32Array;
	#scale: number;
	#re: Float32Array;
	#im: Float32Array;
	/** Per row: the first and last bin it covers, or one fractional bin when it covers none. */
	#low: Float32Array;
	#high: Float32Array;

	/**
	 * @param sampleRate samples per second
	 * @param view which window length to use
	 * @param rows frequency rows from 0 Hz (row 0) up to `maxHz`
	 * @param maxHz top of the frequency axis; capped at half the sample rate
	 */
	constructor(
		readonly sampleRate: number,
		view: View,
		readonly rows: number,
		maxHz = MAX_HZ
	) {
		this.windowSize = Math.max(16, Math.round(WINDOW_S[view] * sampleRate));
		// NOTE: zero-padded to at least 1024, so a short window still fills every row
		this.fftSize = 2 ** Math.ceil(Math.log2(Math.max(this.windowSize, 1024)));
		this.#fft = new FFT(this.fftSize);
		this.#window = hann(this.windowSize);
		// a full-scale sine reads 0 dB
		this.#scale = 2 / this.#window.reduce((sum, w) => sum + w, 0);
		this.#re = new Float32Array(this.fftSize);
		this.#im = new Float32Array(this.fftSize);
		const top = Math.min(maxHz, sampleRate / 2);
		const perBin = sampleRate / this.fftSize;
		const last = this.fftSize / 2;
		this.#low = new Float32Array(rows);
		this.#high = new Float32Array(rows);
		for (let row = 0; row < rows; row++) {
			const from = (row * top) / rows / perBin;
			const to = ((row + 1) * top) / rows / perBin;
			if (to - from < 1) {
				// narrower than a bin: read between the two bins around its middle
				this.#low[row] = this.#high[row] = Math.min(last, (from + to) / 2);
			} else {
				this.#low[row] = Math.ceil(from);
				this.#high[row] = Math.min(last, Math.ceil(to) - 1);
			}
		}
	}

	/**
	 * Adds the power of one window to `out`.
	 *
	 * @param samples the sound
	 * @param start index of the window's first sample; samples outside the sound count as silence
	 * @param out linear power per row, `rows` long; the window's power is added to it
	 */
	accumulate(samples: Float32Array, start: number, out: Float32Array): void {
		const re = this.#re;
		const im = this.#im;
		re.fill(0);
		im.fill(0);
		for (let i = 0; i < this.windowSize; i++) {
			const at = start + i;
			if (at >= 0 && at < samples.length) re[i] = samples[at] * this.#window[i];
		}
		this.#fft.transform(re, im);
		const scale = this.#scale * this.#scale;
		const power = (bin: number) => (re[bin] * re[bin] + im[bin] * im[bin]) * scale;
		for (let row = 0; row < this.rows; row++) {
			const low = this.#low[row];
			const high = this.#high[row];
			let value = 0;
			if (low === high && !Number.isInteger(low)) {
				const bin = Math.floor(low);
				const part = low - bin;
				value = power(bin) * (1 - part) + power(bin + 1) * part;
			} else {
				for (let bin = low; bin <= high; bin++) value = Math.max(value, power(bin));
			}
			out[row] += value;
		}
	}
}

/** Linear power as dB, floored. */
export const powerDb = (power: number) =>
	power <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 10 * Math.log10(power));

/** One column of a picture: the spectrum in dB per row, and the level of the sound under it. */
export type Column = { db: Float32Array; peakDb: number; rmsDb: number };

/**
 * One column of a whole take's spectrogram.
 *
 * The take is cut into `columns` equal spans; a column averages up to four windows
 * spread over its span, so a short window does not show one arbitrary moment of it.
 *
 * @param analyser the view and sample rate
 * @param samples the take
 * @param column which column, from 0
 * @param columns how many columns the picture has
 * @returns the column's spectrum and level
 */
export function takeColumn(
	analyser: Analyser,
	samples: Float32Array,
	column: number,
	columns: number
): Column {
	const span = samples.length / columns;
	const from = Math.floor(column * span);
	const to = Math.max(from + 1, Math.floor((column + 1) * span));
	const windows = Math.min(4, Math.max(1, Math.round(span / analyser.windowSize)));
	const power = new Float32Array(analyser.rows);
	for (let w = 0; w < windows; w++) {
		const centre = from + ((w + 0.5) * (to - from)) / windows;
		analyser.accumulate(samples, Math.round(centre - analyser.windowSize / 2), power);
	}
	const level = levelOf(samples.subarray(from, Math.min(samples.length, to)));
	return {
		db: power.map((p) => powerDb(p / windows)),
		peakDb: level.peakDb,
		rmsDb: level.rmsDb
	};
}

/** The last seconds of a running stream as spectrogram columns, oldest first. */
export class LiveSpectrum {
	readonly columns: number;
	readonly rows: number;
	#analyser: Analyser;
	#buffer: Float32Array;
	#filled = 0;
	#db: Float32Array;
	#peak: Float32Array;
	#rms: Float32Array;
	/** Index of the oldest column in the ring. */
	#head = 0;

	/**
	 * @param sampleRate samples per second of the stream
	 * @param view which window length to use
	 * @param rows frequency rows
	 * @param seconds how much of the stream stays visible
	 */
	constructor(sampleRate: number, view: View, rows: number, seconds = 6) {
		this.#analyser = new Analyser(sampleRate, view, rows);
		this.rows = rows;
		this.columns = Math.ceil((seconds * sampleRate) / LIVE_HOP);
		this.#buffer = new Float32Array(Math.max(this.#analyser.windowSize, LIVE_HOP) + LIVE_HOP);
		this.#db = new Float32Array(this.columns * rows).fill(FLOOR_DB);
		this.#peak = new Float32Array(this.columns).fill(-120);
		this.#rms = new Float32Array(this.columns).fill(-120);
	}

	/**
	 * Takes in the next samples of the stream.
	 *
	 * @returns how many columns were added
	 */
	push(block: Float32Array): number {
		const need = Math.max(this.#analyser.windowSize, LIVE_HOP);
		let added = 0;
		let read = 0;
		while (read < block.length) {
			const count = Math.min(block.length - read, this.#buffer.length - this.#filled);
			this.#buffer.set(block.subarray(read, read + count), this.#filled);
			this.#filled += count;
			read += count;
			while (this.#filled >= need) {
				const power = new Float32Array(this.rows);
				this.#analyser.accumulate(this.#buffer, 0, power);
				const level = levelOf(this.#buffer.subarray(0, LIVE_HOP));
				const at = this.#head;
				for (let row = 0; row < this.rows; row++)
					this.#db[at * this.rows + row] = powerDb(power[row]);
				this.#peak[at] = level.peakDb;
				this.#rms[at] = level.rmsDb;
				this.#head = (this.#head + 1) % this.columns;
				this.#buffer.copyWithin(0, LIVE_HOP, this.#filled);
				this.#filled -= LIVE_HOP;
				added++;
			}
		}
		return added;
	}

	/** The column `index` places after the oldest one. */
	column(index: number): Column {
		const at = (this.#head + index) % this.columns;
		return {
			db: this.#db.subarray(at * this.rows, (at + 1) * this.rows),
			peakDb: this.#peak[at],
			rmsDb: this.#rms[at]
		};
	}

	/** The loudest point in view, in dB. */
	get topDb(): number {
		let top = FLOOR_DB;
		for (let i = 0; i < this.#db.length; i++) if (this.#db[i] > top) top = this.#db[i];
		return top;
	}
}

/** The level the ramp's strongest colour stands for, given the loudest point of a picture. */
export const rampTop = (loudestDb: number) => Math.max(loudestDb, MIN_TOP_DB);

// NOTE: one hue from the card's surface to its far end (light: white to plum, dark:
// aubergine to blush), lightness monotonic; the stops are the theme's rose in OKLCH
const STOPS = {
	light: ['#ffffff', '#ffcee0', '#f37fb0', '#c62b7a', '#711653', '#2d0b27'],
	dark: ['#281b28', '#602349', '#a72a68', '#e25a98', '#fda6c8', '#ffedf8']
} as const;

/**
 * The colour ramp of a theme.
 *
 * @returns 256 colours as RGB bytes, from silence (the card's surface) to the loudest
 */
export function ramp(dark: boolean): Uint8ClampedArray {
	const stops = STOPS[dark ? 'dark' : 'light'].map((hex) =>
		[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
	);
	const out = new Uint8ClampedArray(256 * 3);
	for (let i = 0; i < 256; i++) {
		const position = (i / 255) * (stops.length - 1);
		const index = Math.min(stops.length - 2, Math.floor(position));
		const part = position - index;
		for (let c = 0; c < 3; c++)
			out[i * 3 + c] = stops[index][c] + (stops[index + 1][c] - stops[index][c]) * part;
	}
	return out;
}

/** How a picture is laid out: the spectrogram on top, a gap, the level strip below. */
export type Layout = { rows: number; gap: number; levelRows: number };

/** The height of a picture in pixels. */
export const layoutHeight = (layout: Layout) => layout.rows + layout.gap + layout.levelRows;

/** Where a ramp index sits for a level: 0 at `RANGE_DB` below `top`, 255 at `top`. */
export const shade = (db: number, top: number) =>
	Math.round(255 * Math.min(1, Math.max(0, (db - (top - RANGE_DB)) / RANGE_DB)));

/**
 * Paints one column of a picture.
 *
 * @param image RGBA pixels, `layoutHeight(layout)` high
 * @param x the pixel column
 * @param column what to paint
 * @param top the level of the ramp's strongest colour (`rampTop`)
 * @param colours the theme's ramp
 * @param layout the picture's layout
 */
export function paintColumn(
	image: { data: Uint8ClampedArray; width: number; height: number },
	x: number,
	column: Column,
	top: number,
	colours: Uint8ClampedArray,
	layout: Layout
): void {
	const { data, width } = image;
	const put = (y: number, index: number) => {
		const at = (y * width + x) * 4;
		data[at] = colours[index * 3];
		data[at + 1] = colours[index * 3 + 1];
		data[at + 2] = colours[index * 3 + 2];
		data[at + 3] = 255;
	};
	for (let row = 0; row < layout.rows; row++)
		put(layout.rows - 1 - row, shade(column.db[row], top));
	for (let y = layout.rows; y < layout.rows + layout.gap; y++) put(y, 0);
	// the level strip: peak in a light step, RMS in a stronger one, on a -60…0 dBFS scale
	const height = (db: number) =>
		Math.round(layout.levelRows * Math.min(1, Math.max(0, 1 + db / 60)));
	const peak = height(column.peakDb);
	const rms = height(column.rmsDb);
	const bottom = layoutHeight(layout) - 1;
	for (let h = 0; h < layout.levelRows; h++) put(bottom - h, h < rms ? 150 : h < peak ? 70 : 0);
}

/** Frequency at a height inside the spectrogram part of a picture: 0 at its bottom, 1 at its top. */
export const frequencyAt = (fraction: number, sampleRate: number) =>
	fraction * Math.min(MAX_HZ, sampleRate / 2);
