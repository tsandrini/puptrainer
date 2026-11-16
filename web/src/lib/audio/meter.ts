// Level measurement for the recording meter. Plain functions, no browser
// APIs, so they run in tests.

/** The quietest level reported, in dBFS. */
export const FLOOR_DB = -120;
/** The zone the loudest parts of a take should reach, in dBFS. */
export const TARGET_DB = { low: -12, high: -6 } as const;
/** Samples at or above this magnitude count as clipped. */
export const CLIP = 0.999;

export type Level = { peakDb: number; rmsDb: number; clipped: number };

/** An amplitude relative to full scale, in dB. */
export function dbfs(amplitude: number): number {
	return amplitude <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(amplitude));
}

/** Peak, RMS and the number of clipped samples of one block. */
export function levelOf(block: Float32Array): Level {
	let peak = 0;
	let sum = 0;
	let clipped = 0;
	for (let i = 0; i < block.length; i++) {
		const a = Math.abs(block[i]);
		if (a > peak) peak = a;
		if (a >= CLIP) clipped++;
		sum += a * a;
	}
	return {
		peakDb: dbfs(peak),
		rmsDb: dbfs(block.length ? Math.sqrt(sum / block.length) : 0),
		clipped
	};
}

/** Where a level sits on a meter from `minDb` to 0 dBFS, as 0…1. */
export function meterPosition(db: number, minDb = -60): number {
	return Math.min(1, Math.max(0, (db - minDb) / -minDb));
}
