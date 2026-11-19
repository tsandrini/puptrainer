import { describe, expect, it } from 'vitest';
import {
	Analyser,
	FFT,
	LIVE_HOP,
	LiveSpectrum,
	hann,
	layoutHeight,
	paintColumn,
	powerDb,
	ramp,
	rampTop,
	shade,
	takeColumn
} from './spectrum.js';

const RATE = 48000;
const sine = (hz: number, seconds: number, amplitude = 1) =>
	Float32Array.from(
		{ length: Math.round(seconds * RATE) },
		(_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)
	);
const loudest = (db: Float32Array) => db.indexOf(Math.max(...db));

describe('FFT', () => {
	it('puts a sine in its bin', () => {
		const fft = new FFT(64);
		const re = Float32Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / 64));
		const im = new Float32Array(64);
		fft.transform(re, im);
		const magnitude = Array.from(re, (r, i) => Math.hypot(r, im[i]));
		expect(magnitude[5]).toBeCloseTo(32, 3);
		expect(magnitude[59]).toBeCloseTo(32, 3);
		expect(Math.max(...magnitude.filter((_, i) => i !== 5 && i !== 59))).toBeLessThan(1e-3);
	});

	it('refuses a size that is not a power of two', () => {
		expect(() => new FFT(100)).toThrow(RangeError);
	});
});

describe('Analyser', () => {
	it('reads a full-scale sine as 0 dB in the row of its frequency', () => {
		for (const view of ['harmonics', 'formants'] as const) {
			const analyser = new Analyser(RATE, view, 100);
			const power = new Float32Array(100);
			analyser.accumulate(sine(1025, 0.2), 2000, power);
			const db = power.map(powerDb);
			expect(loudest(db)).toBe(20); // 1000–1050 Hz of 0–5000 Hz in 100 rows
			expect(db[20]).toBeGreaterThan(-1.5);
			expect(db[20]).toBeLessThan(0.1);
			expect(db[80]).toBeLessThan(-60);
		}
	});

	it('scales with the amplitude and treats the outside of the sound as silence', () => {
		const analyser = new Analyser(RATE, 'harmonics', 100);
		const power = new Float32Array(100);
		analyser.accumulate(sine(1025, 0.2, 0.1), 2000, power);
		expect(powerDb(power[20])).toBeCloseTo(-20, 0);
		const outside = new Float32Array(100);
		analyser.accumulate(sine(1025, 0.2), -100000, outside);
		expect(Math.max(...outside)).toBe(0);
	});

	it('separates harmonics only with the long window', () => {
		const voice = sine(200, 0.3, 0.4).map(
			(v, i) => v + 0.4 * Math.sin((2 * Math.PI * 400 * i) / RATE)
		);
		const dip = (view: 'harmonics' | 'formants') => {
			const analyser = new Analyser(RATE, view, 250); // 20 Hz rows
			const power = new Float32Array(250);
			analyser.accumulate(voice, 4000, power);
			return powerDb(power[10]) - powerDb(power[15]); // 200 Hz against 300 Hz
		};
		expect(dip('harmonics')).toBeGreaterThan(30);
		expect(dip('formants')).toBeLessThan(6);
	});

	it('caps the axis at half the sample rate', () => {
		const analyser = new Analyser(8000, 'harmonics', 100);
		const power = new Float32Array(100);
		const tone = Float32Array.from({ length: 4000 }, (_, i) =>
			Math.sin((2 * Math.PI * 2000 * i) / 8000)
		);
		analyser.accumulate(tone, 500, power);
		expect(loudest(power.map(powerDb))).toBe(50);
	});

	it('has a window that starts at zero and peaks in the middle', () => {
		const window = hann(8);
		expect(window[0]).toBe(0);
		expect(window[4]).toBeCloseTo(1);
	});
});

describe('takeColumn', () => {
	it('follows a take that changes pitch, with its level', () => {
		const take = new Float32Array(2 * RATE);
		take.set(sine(500, 1, 0.5), 0);
		take.set(sine(2000, 1, 0.05), RATE);
		const analyser = new Analyser(RATE, 'harmonics', 100);
		const early = takeColumn(analyser, take, 10, 100);
		const late = takeColumn(analyser, take, 80, 100);
		expect(loudest(early.db)).toBe(10);
		expect(loudest(late.db)).toBe(40);
		expect(early.peakDb).toBeCloseTo(-6, 0);
		expect(early.rmsDb).toBeCloseTo(-9, 0);
		expect(late.peakDb).toBeCloseTo(-26, 0);
	});

	it('copes with more columns than windows fit, and with an empty take', () => {
		const analyser = new Analyser(RATE, 'harmonics', 50);
		const short = takeColumn(analyser, sine(1050, 0.05), 399, 400);
		expect(loudest(short.db)).toBe(10);
		const empty = takeColumn(analyser, new Float32Array(0), 0, 10);
		expect(empty.peakDb).toBe(-120);
		expect(Math.max(...empty.db)).toBe(-140);
	});
});

describe('LiveSpectrum', () => {
	it('adds a column per hop, whatever the size of the blocks, oldest first', () => {
		const live = new LiveSpectrum(RATE, 'harmonics', 100, 1);
		expect(live.columns).toBe(Math.ceil(RATE / LIVE_HOP));
		expect(live.topDb).toBe(-140);
		const stream = new Float32Array(RATE);
		stream.set(sine(500, 0.5, 0.5), 0);
		stream.set(sine(3000, 0.5, 0.5), RATE / 2);
		let added = 0;
		for (let at = 0; at < stream.length; at += 2048)
			added += live.push(stream.subarray(at, at + 2048));
		expect(added).toBe(Math.floor((RATE - 2208) / LIVE_HOP) + 1);
		const newest = live.column(live.columns - 1);
		expect(loudest(newest.db)).toBe(60);
		expect(newest.peakDb).toBeCloseTo(-6, 0);
		// the first column written sits `added` places before the end
		expect(loudest(live.column(live.columns - added).db)).toBe(10);
		expect(live.column(0).peakDb).toBe(-120);
		expect(live.topDb).toBeGreaterThan(-8);
	});

	it('keeps only what is in view', () => {
		const live = new LiveSpectrum(RATE, 'formants', 50, 0.5);
		live.push(sine(500, 1, 0.5));
		live.push(new Float32Array(RATE));
		expect(live.topDb).toBe(-140);
	});
});

describe('painting', () => {
	it('has a ramp from the surface to the far end, monotonic in lightness', () => {
		for (const dark of [false, true]) {
			const colours = ramp(dark);
			const luma = (i: number) =>
				0.2126 * colours[i * 3] + 0.7152 * colours[i * 3 + 1] + 0.0722 * colours[i * 3 + 2];
			for (let i = 1; i < 256; i++)
				expect(dark ? luma(i) >= luma(i - 1) - 0.5 : luma(i) <= luma(i - 1) + 0.5).toBe(true);
		}
		expect([...ramp(false).slice(0, 3)]).toEqual([255, 255, 255]);
		expect([...ramp(true).slice(0, 3)]).toEqual([0x28, 0x1b, 0x28]);
	});

	it('shades relative to the loudest point, and keeps silence dark', () => {
		expect(shade(-20, -20)).toBe(255);
		expect(shade(-85, -20)).toBe(0);
		expect(shade(-200, -20)).toBe(0);
		expect(shade(0, -20)).toBe(255);
		expect(rampTop(-12)).toBe(-12);
		expect(rampTop(-140)).toBe(-50);
	});

	it('paints a column: low frequencies at the bottom of the spectrogram, the level under it', () => {
		const layout = { rows: 4, gap: 1, levelRows: 4 };
		const image = {
			data: new Uint8ClampedArray(2 * layoutHeight(layout) * 4),
			width: 2,
			height: 9
		};
		const colours = ramp(false);
		const column = { db: Float32Array.from([-20, -200, -200, -200]), peakDb: -15, rmsDb: -30 };
		paintColumn(image, 1, column, -20, colours, layout);
		const index = (y: number) => {
			const at = (y * 2 + 1) * 4;
			for (let i = 0; i < 256; i++)
				if (colours[i * 3] === image.data[at] && colours[i * 3 + 1] === image.data[at + 1])
					return i;
			return -1;
		};
		expect([0, 1, 2, 3].map(index)).toEqual([0, 0, 0, 255]);
		expect(index(4)).toBe(0);
		// -30 dBFS is half of the strip, -15 three quarters
		expect([5, 6, 7, 8].map(index)).toEqual([0, 70, 150, 150]);
		expect(image.data[3]).toBe(0); // the other column is untouched
		expect(image.data[7]).toBe(255);
	});
});
