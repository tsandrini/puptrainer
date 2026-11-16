import { describe, expect, it } from 'vitest';
import { dbfs, levelOf, meterPosition } from './meter.js';
import { detectPitch } from './pitch.js';
import { encodeWav } from './wav.js';

const RATE = 48000;

/** A voice-like tone: harmonics falling off as 1/k. */
function tone(hz: number, samples = 2048, amplitude = 0.3): Float32Array {
	const out = new Float32Array(samples);
	let peak = 0;
	for (let i = 0; i < samples; i++) {
		for (let k = 1; k <= 10; k++) out[i] += Math.sin((2 * Math.PI * k * hz * i) / RATE) / k;
		peak = Math.max(peak, Math.abs(out[i]));
	}
	return out.map((v) => (amplitude * v) / peak);
}

describe('meter', () => {
	it('converts amplitudes to dBFS', () => {
		expect(dbfs(1)).toBe(0);
		expect(dbfs(0.5)).toBeCloseTo(-6.02, 2);
		expect(dbfs(0)).toBe(-120);
	});

	it('measures peak, RMS and clipping of a block', () => {
		const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(i / 10));
		const level = levelOf(sine);
		expect(level.peakDb).toBeCloseTo(-6.02, 1);
		expect(level.rmsDb).toBeCloseTo(-9.03, 1);
		expect(level.clipped).toBe(0);
		expect(levelOf(new Float32Array([0, 1, -1, 0.9995, 0.5])).clipped).toBe(3);
		expect(levelOf(new Float32Array(0))).toEqual({ peakDb: -120, rmsDb: -120, clipped: 0 });
	});

	it('places a level on the meter', () => {
		expect(meterPosition(0)).toBe(1);
		expect(meterPosition(-60)).toBe(0);
		expect(meterPosition(-30)).toBeCloseTo(0.5);
		expect(meterPosition(-90)).toBe(0);
	});
});

describe('wav', () => {
	it('writes a mono 24-bit PCM header and the samples', () => {
		const blocks = [new Float32Array([0, 0.5, -0.5]), new Float32Array([1, -1])];
		const view = new DataView(encodeWav(blocks, RATE));
		const text = (o: number) =>
			String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
		expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint32(24, true)).toBe(RATE);
		expect(view.getUint16(34, true)).toBe(24);
		expect(view.getUint32(40, true)).toBe(5 * 3);
		expect(view.byteLength).toBe(44 + 15);
		expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
		const sample = (i: number) => {
			const o = 44 + 3 * i;
			const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
			return v & 0x800000 ? v - 0x1000000 : v;
		};
		expect([0, 1, 2, 3, 4].map(sample)).toEqual([0, 4194304, -4194304, 8388607, -8388607]);
	});

	it('clamps samples beyond full scale', () => {
		const view = new DataView(encodeWav([new Float32Array([2, -2])], RATE));
		expect(view.getUint8(44 + 2)).toBe(0x7f);
		expect(view.getUint8(44 + 5)).toBe(0x80);
	});
});

describe('pitch', () => {
	it.each([90, 110, 172, 220, 330, 440])('finds a %i Hz tone', (hz) => {
		const pitch = detectPitch(tone(hz), RATE);
		expect(pitch).not.toBeNull();
		expect(pitch!.hz).toBeGreaterThan(hz * 0.99);
		expect(pitch!.hz).toBeLessThan(hz * 1.01);
		expect(pitch!.clarity).toBeGreaterThan(0.9);
	});

	it('reports nothing for silence and for noise', () => {
		expect(detectPitch(new Float32Array(2048), RATE)).toBeNull();
		let seed = 1;
		const noise = Float32Array.from({ length: 2048 }, () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return 0.2 * (seed / 2147483648 - 1);
		});
		expect(detectPitch(noise, RATE)).toBeNull();
	});

	it('reports nothing for a block shorter than two periods', () => {
		expect(detectPitch(tone(100, 64), RATE)).toBeNull();
	});
});
