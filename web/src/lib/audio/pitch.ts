// Live pitch for the recording screen: the McLeod pitch method (normalised
// square difference, first strong peak) on one block. A guide while
// speaking; the stored numbers come from the backend's pipeline.

export type Pitch = { hz: number; clarity: number };

/** Blocks quieter than this (mean square) are not analysed: about -60 dBFS. */
const SILENCE = 1e-6;
/** A peak this close to the best one wins if it comes first (a shorter period). */
const FIRST_PEAK = 0.9;
/** Below this the block is treated as unvoiced. */
const MIN_CLARITY = 0.6;

/**
 * The pitch of one block of samples.
 *
 * @param block samples in [-1, 1]; at least two periods of the lowest pitch wanted
 * @param sampleRate samples per second
 * @param minHz lowest pitch searched
 * @param maxHz highest pitch searched
 * @returns the pitch and how periodic the block is (0…1), or null for silence and noise
 */
export function detectPitch(
	block: Float32Array,
	sampleRate: number,
	minHz = 60,
	maxHz = 800
): Pitch | null {
	const n = block.length;
	const maxLag = Math.min(n - 2, Math.floor(sampleRate / minHz));
	const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
	if (maxLag <= minLag) return null;
	let energy = 0;
	for (let i = 0; i < n; i++) energy += block[i] * block[i];
	if (energy / n < SILENCE) return null;

	const nsdf = new Float32Array(maxLag + 2);
	for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
		let acf = 0;
		let norm = 0;
		for (let i = 0; i < n - lag; i++) {
			acf += block[i] * block[i + lag];
			norm += block[i] * block[i] + block[i + lag] * block[i + lag];
		}
		nsdf[lag] = norm > 0 ? (2 * acf) / norm : 0;
	}

	let best = 0;
	const peaks: number[] = [];
	for (let lag = minLag; lag <= maxLag; lag++) {
		if (nsdf[lag] > 0 && nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
			peaks.push(lag);
			if (nsdf[lag] > best) best = nsdf[lag];
		}
	}
	if (best < MIN_CLARITY) return null;
	const lag = peaks.find((p) => nsdf[p] >= FIRST_PEAK * best)!;
	// parabolic interpolation around the peak
	const [a, b, c] = [nsdf[lag - 1], nsdf[lag], nsdf[lag + 1]];
	const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
	return { hz: sampleRate / (lag + shift), clarity: b };
}
