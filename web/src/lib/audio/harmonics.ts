// How far the fundamental of a voice stands above its second harmonic: the
// "lightness" of the live graph. A guide while recording; the stored value
// comes from the backend's pipeline, which measures the same thing.

/** How far either side of a harmonic its level is looked for, as a share of its frequency. */
const SEARCH = 0.03;

/** The magnitude of a Hann-windowed frame at one frequency. */
function magnitude(frame: Float32Array, sampleRate: number, hz: number): number {
	const n = frame.length;
	const turn = (2 * Math.PI * hz) / sampleRate;
	let re = 0;
	let im = 0;
	for (let i = 0; i < n; i++) {
		const sample = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
		re += sample * Math.cos(turn * i);
		im -= sample * Math.sin(turn * i);
	}
	return Math.hypot(re, im);
}

/** The strongest level at a harmonic, a little either side of where the pitch puts it. */
const harmonic = (frame: Float32Array, sampleRate: number, hz: number) =>
	Math.max(
		magnitude(frame, sampleRate, hz * (1 - SEARCH)),
		magnitude(frame, sampleRate, hz),
		magnitude(frame, sampleRate, hz * (1 + SEARCH))
	);

/**
 * How far the fundamental stands above the second harmonic (H1–H2).
 *
 * Uncorrected: a first resonance close to either harmonic shifts it, so it is compared
 * on the same sound only.
 *
 * @param frame about 50 ms of voiced sound
 * @param sampleRate its sample rate
 * @param pitchHz its pitch
 * @returns the lead in dB, or null when either harmonic is missing or out of range
 */
export function harmonicLead(
	frame: Float32Array,
	sampleRate: number,
	pitchHz: number
): number | null {
	if (!(pitchHz > 0) || 2 * pitchHz * (1 + SEARCH) >= sampleRate / 2) return null;
	const first = harmonic(frame, sampleRate, pitchHz);
	const second = harmonic(frame, sampleRate, 2 * pitchHz);
	return first > 0 && second > 0 ? 20 * Math.log10(first / second) : null;
}
