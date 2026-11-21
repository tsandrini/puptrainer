// What the microphone hears, block by block, kept for the live graph and for
// the picture of a take right after it is recorded: pitch, level, the
// resonances and how far the fundamental leads. A guide: the saved take is
// measured by the backend's pipeline, more carefully.

import type { Trace, TraceRow, TraceZero } from '../api/types.js';
import {
	FRAME_S,
	MAX_PITCH_HZ,
	brightnessPct,
	firstPct,
	formantsOf,
	type Formants,
	type Mode
} from './formants.js';
import { harmonicLead } from './harmonics.js';

/** One block of the stream as the graph keeps it. */
export type Point = {
	/** Seconds from the start of the stream to the end of the block. */
	at: number;
	pitchHz: number | null;
	levelDb: number;
	formants: Formants | null;
	/** How far the fundamental leads the second harmonic, in dB. */
	leadDb: number | null;
};

/** What the rows of a live trace are made of. */
export type Rows = {
	/** What brightness and R1 are counted from; null until there is a zero. */
	base: Formants | null;
	/**
	 * Running speech: its resonances follow the words, so brightness is a slow value
	 * (the last `SPEECH_S`) and R1 is left out.
	 */
	speech: boolean;
	/** Without resonance rows at all (a pitch exercise). */
	resonance: boolean;
};

/** From this lead of the fundamental on, the first resonance cannot be read (as the backend). */
export const R1_MAX_LEAD_DB = 12;
/** A first resonance below this many times the pitch is the pitch itself. */
export const PITCH_RATIO = 1.25;
/** Blocks this far under the loudest recent one are not read on resonance. */
const GATE_DB = 20;
/** How fast the memory of the loudest block fades, in dB per block. */
const FADE_DB = 0.3;
const SILENCE_DB = -55;
/** How long a held sound's values are steadied over, in seconds. */
const HOLD_S = 0.25;
/** How long the brightness of speech is taken over: shorter than that, it is the vowels. */
const SPEECH_S = 8;

const median = (values: number[]): number | null => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const half = sorted.length >> 1;
	return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

const middle = (frames: Formants[]): Formants | null =>
	frames.length
		? ([0, 1, 2, 3].map((k) => median(frames.map((f) => f[k]))!) as unknown as Formants)
		: null;

/** A running stream of blocks, measured for the live graph. */
export class LiveTrack {
	readonly points: Point[] = [];
	#rate = 0;
	#frame = new Float32Array(0);
	#samples = 0;
	#loudest = -120;

	/** @param mode a voice (`voiced`), or a whisper that a voice may come into (`whisper`) */
	constructor(readonly mode: Mode = 'voiced') {}

	/** Seconds of the stream so far. */
	get seconds(): number {
		return this.#rate ? this.#samples / this.#rate : 0;
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
			this.#frame = new Float32Array(Math.round(FRAME_S * sampleRate));
		}
		// the last 50 ms of the stream: what the resonances are read from
		const frame = this.#frame;
		if (block.length >= frame.length) {
			frame.set(block.subarray(block.length - frame.length));
		} else {
			frame.copyWithin(0, block.length);
			frame.set(block, frame.length - block.length);
		}
		this.#samples += block.length;
		let sum = 0;
		for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
		const levelDb = sum > 0 ? 10 * Math.log10(sum / block.length) : -120;
		this.#loudest = Math.max(levelDb, this.#loudest - FADE_DB);
		const sounding = levelDb >= Math.max(SILENCE_DB, this.#loudest - GATE_DB);
		const voiced = pitchHz !== null && pitchHz <= MAX_PITCH_HZ;
		const read = sounding && (voiced || (this.mode === 'whisper' && !voiced));
		this.points.push({
			at: this.#samples / sampleRate,
			pitchHz,
			levelDb,
			formants: read ? formantsOf(frame, sampleRate) : null,
			leadDb: sounding && voiced ? harmonicLead(frame, sampleRate, pitchHz) : null
		});
	}

	/**
	 * The stream between two moments as rows over time, in the shape of a take's trace.
	 *
	 * Each step is the median of its blocks. Brightness and R1 are counted from
	 * `rows.base`; a held sound is steadied over a quarter of a second, the brightness of
	 * speech is the last eight seconds. Where a voice is too light for its first
	 * resonance to be read, the step is marked and R1 left out.
	 *
	 * @param from start of the stretch, in seconds of the stream (may be negative)
	 * @param to its end
	 * @param step seconds per value
	 * @param rows what the rows are made of
	 * @param zero what the resonance rows are counted from, for the caption
	 */
	trace(from: number, to: number, step: number, rows: Rows, zero: TraceZero | null = null): Trace {
		const steps = Math.max(0, Math.round((to - from) / step));
		const blank = (): (number | null)[] => Array.from({ length: steps }, () => null);
		const pitch = blank();
		const level = blank();
		const lead = blank();
		const bright = blank();
		const first = blank();
		const unreadable = Array.from({ length: steps }, () => false);
		const points = this.points;
		const wide = rows.speech ? SPEECH_S : HOLD_S;
		let start = 0;
		let back = 0;
		let far = 0;
		for (let index = 0; index < steps; index++) {
			const a = from + index * step;
			const b = a + step;
			while (start < points.length && points[start].at <= a) start++;
			let end = start;
			while (end < points.length && points[end].at <= b) end++;
			if (end === start) continue;
			const inside = points.slice(start, end);
			pitch[index] = median(inside.flatMap((p) => p.pitchHz ?? []));
			level[index] = median(inside.map((p) => p.levelDb));
			while (back < end && points[back].at <= b - HOLD_S) back++;
			const held = points.slice(Math.min(back, start), end);
			const leading = median(held.flatMap((p) => p.leadDb ?? []));
			lead[index] = leading;
			if (!rows.resonance || !rows.base) continue;
			while (far < end && points[far].at <= b - wide) far++;
			const shape = middle(
				points.slice(Math.min(far, start), end).flatMap((p) => (p.formants ? [p.formants] : []))
			);
			// NOTE: a step without sound of its own draws nothing, however long the memory
			if (!shape || !inside.some((p) => p.formants)) continue;
			bright[index] = brightnessPct(shape, rows.base);
			if (rows.speech) continue;
			const hz = pitch[index];
			const voiced = hz !== null && hz <= MAX_PITCH_HZ;
			const light = leading !== null && leading >= R1_MAX_LEAD_DB;
			if (voiced && (light || shape[0] < PITCH_RATIO * hz)) unreadable[index] = true;
			else first[index] = firstPct(shape, rows.base);
		}
		const made: TraceRow[] = [{ key: 'pitch_hz', values: pitch }];
		if (rows.resonance) {
			made.push({ key: 'brightness_pct', values: bright });
			if (!rows.speech) made.push({ key: 'r1_pct', values: first });
		}
		made.push({ key: 'lightness_db', values: lead }, { key: 'level_db', values: level });
		return {
			start_s: step / 2,
			step_s: step,
			rows: made,
			r1_unreadable: unreadable,
			zero: rows.resonance && rows.base && !rows.speech ? zero : null,
			spans: []
		};
	}

	/** The newest pitch and brightness that go together, for the map; null without both. */
	now(base: Formants | null): { pitchHz: number; brightPct: number } | null {
		const since = this.seconds - HOLD_S;
		const recent = this.points.filter((p) => p.at > since);
		const hz = median(recent.flatMap((p) => p.pitchHz ?? []));
		const shape = middle(recent.flatMap((p) => (p.formants ? [p.formants] : [])));
		if (!base || hz === null || hz > MAX_PITCH_HZ || !shape) return null;
		return { pitchHz: hz, brightPct: brightnessPct(shape, base) };
	}
}
