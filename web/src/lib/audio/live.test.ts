import { describe, expect, it } from 'vitest';
import { BLOCK, type Formants } from './formants.js';
import { harmonicLead } from './harmonics.js';
import { LiveTrack } from './live.js';
import { detectPitch } from './pitch.js';

const RATE = 48000;
const AH: Formants = [750, 1200, 2500, 3500];
const SMALL: Formants = [860, 1380, 2875, 4025];

/** The resonances of a tube: the given ones, continued upwards at their last spacing. */
function tube(formants: readonly number[]): number[] {
	const all = [...formants];
	const step = all[all.length - 1] - all[all.length - 2];
	while (all[all.length - 1] + step < 20000) all.push(all[all.length - 1] + step);
	return all;
}

/** A synthetic vowel; `leadDb` raises its fundamental over the other harmonics. */
function vowel(formants: readonly number[], f0: number, seconds: number, leadDb = 0): Float32Array {
	const out = new Float32Array(Math.round(seconds * RATE));
	const resonances = tube(formants);
	for (let k = 1; k * f0 < 8000; k++) {
		const f = k * f0;
		let gain = (k === 1 ? 10 ** (leadDb / 20) : 1) / k;
		for (const centre of resonances) {
			const width = 80 + 0.02 * centre;
			gain /= Math.sqrt((1 - (f / centre) ** 2) ** 2 + ((f * width) / centre ** 2) ** 2);
		}
		for (let i = 0; i < out.length; i++)
			out[i] += gain * Math.sin((2 * Math.PI * f * i) / RATE + 1.7 * k);
	}
	let peak = 0;
	for (const v of out) peak = Math.max(peak, Math.abs(v));
	return out.map((v) => (0.3 * v) / peak);
}

/** A plain harmonic tone whose first two harmonics have known levels. */
function pair(f0: number, secondDb: number, seconds = 0.05): Float32Array {
	const second = 10 ** (secondDb / 20);
	return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
		const t = (2 * Math.PI * f0 * i) / RATE;
		return 0.4 * Math.sin(t) + 0.4 * second * Math.sin(2 * t + 0.4);
	});
}

function feed(track: LiveTrack, ...sounds: Float32Array[]): void {
	for (const sound of sounds) {
		for (let start = 0; start + BLOCK <= sound.length; start += BLOCK) {
			const block = sound.subarray(start, start + BLOCK);
			track.push(block, RATE, detectPitch(block, RATE)?.hz ?? null);
		}
	}
}

const row = (trace: ReturnType<LiveTrack['trace']>, key: string) =>
	trace.rows.find((r) => r.key === key)!.values;
const held = { speech: false, resonance: true };

describe('harmonicLead', () => {
	it('reads how far the fundamental stands above the second harmonic', () => {
		expect(harmonicLead(pair(200, -12), RATE, 200)).toBeCloseTo(12, 0);
		expect(harmonicLead(pair(170, 6), RATE, 170)).toBeCloseTo(-6, 0);
		// a pitch that is a little off still finds its harmonics
		expect(harmonicLead(pair(200, -12), RATE, 203)).toBeCloseTo(12, 0);
	});

	it('has nothing to say without a pitch, or above what the sample rate holds', () => {
		expect(harmonicLead(pair(200, -12), RATE, 0)).toBeNull();
		expect(harmonicLead(pair(200, -12), RATE, 13000)).toBeNull();
		expect(harmonicLead(new Float32Array(2400), RATE, 200)).toBeNull();
	});
});

describe('LiveTrack', () => {
	it('draws a held sound against its zero', () => {
		const track = new LiveTrack();
		feed(track, vowel(AH, 180, 1.5), vowel(SMALL, 180, 1.5));
		expect(track.seconds).toBeCloseTo(3, 0);
		const trace = track.trace(0, 3, 0.1, { ...held, base: AH }, 'first-sound');
		expect(trace.rows.map((r) => r.key)).toEqual([
			'pitch_hz',
			'brightness_pct',
			'r1_pct',
			'lightness_db',
			'level_db'
		]);
		expect(trace.zero).toBe('first-sound');
		expect(row(trace, 'pitch_hz')[10]).toBeCloseTo(180, 0);
		expect(Math.abs(row(trace, 'brightness_pct')[10]!)).toBeLessThan(6);
		// the second sound is a tube 15% shorter
		expect(row(trace, 'brightness_pct')[25]!).toBeGreaterThan(9);
		expect(row(trace, 'r1_pct')[25]!).toBeGreaterThan(7);
		expect(trace.r1_unreadable.some(Boolean)).toBe(false);
		expect(track.now(AH)!.pitchHz).toBeCloseTo(180, 0);
		expect(track.now(AH)!.brightPct).toBeGreaterThan(9);
		// the first second of sound is what a moving picture counts its levels from
		const first = track.opening()!;
		expect(first.levelDb).toBeCloseTo(row(trace, 'level_db')[5]!, 0);
		expect(first.leadDb).toBeCloseTo(row(trace, 'lightness_db')[5]!, 0);
	});

	it('marks a light voice: its first resonance is not read, its brightness is', () => {
		const track = new LiveTrack();
		feed(track, vowel(AH, 220, 1.5, 18));
		const trace = track.trace(0, 1.5, 0.1, { ...held, base: AH }, 'first-sound');
		expect(row(trace, 'lightness_db')[10]!).toBeGreaterThan(12);
		expect(trace.r1_unreadable[10]).toBe(true);
		expect(row(trace, 'r1_pct')[10]).toBeNull();
		expect(row(trace, 'brightness_pct')[10]).not.toBeNull();
	});

	it('leaves the resonance rows out of a pitch exercise, and R1 out of speech', () => {
		const track = new LiveTrack();
		feed(track, vowel(AH, 180, 1));
		const pitch = track.trace(0, 1, 0.1, { base: null, speech: false, resonance: false });
		expect(pitch.rows.map((r) => r.key)).toEqual(['pitch_hz', 'lightness_db', 'level_db']);
		const speech = track.trace(0, 1, 0.1, { base: AH, speech: true, resonance: true });
		expect(speech.rows.map((r) => r.key)).toEqual([
			'pitch_hz',
			'brightness_pct',
			'lightness_db',
			'level_db'
		]);
		expect(speech.zero).toBeNull();
	});

	it('draws nothing where there was nothing, and no resonance before there is a zero', () => {
		const track = new LiveTrack();
		feed(track, new Float32Array(RATE), vowel(AH, 180, 1));
		const trace = track.trace(-1, 2, 0.1, { ...held, base: null });
		expect(
			row(trace, 'pitch_hz')
				.slice(0, 20)
				.every((v) => v === null)
		).toBe(true);
		expect(row(trace, 'level_db')[5]).toBeNull();
		expect(row(trace, 'level_db')[15]).toBe(-120);
		expect(row(trace, 'pitch_hz')[25]).toBeCloseTo(180, 0);
		expect(row(trace, 'brightness_pct').every((v) => v === null)).toBe(true);
		expect(track.now(null)).toBeNull();
		// a second of sound has not passed yet
		const early = new LiveTrack();
		feed(early, new Float32Array(RATE), vowel(AH, 180, 0.5));
		expect(early.opening()).toBeNull();
	});
});
