// A reference note for the note-matching drill: a soft tone with a few
// harmonics (a pure sine is faint on small speakers), faded in and out.
// It is played before recording starts, never during: the recorder's echo
// cancellation is off, so a tone from the speakers would be recorded.

/** Relative amplitudes of the first harmonics. */
const HARMONICS = [1, 0.5, 0.25, 0.12];
const FADE_S = 0.04;

/**
 * Plays a note.
 *
 * @param hz its pitch
 * @param seconds how long it sounds
 * @param volume peak gain, 0..1
 * @returns when it has finished
 */
export async function playTone(hz: number, seconds = 1.5, volume = 0.25): Promise<void> {
	const context = new AudioContext();
	try {
		const real = new Float32Array([0, ...HARMONICS]);
		const wave = context.createPeriodicWave(real, new Float32Array(real.length));
		const oscillator = context.createOscillator();
		oscillator.setPeriodicWave(wave);
		oscillator.frequency.value = hz;
		const gain = context.createGain();
		const start = context.currentTime + 0.02;
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(volume, start + FADE_S);
		gain.gain.setValueAtTime(volume, start + seconds - FADE_S);
		gain.gain.linearRampToValueAtTime(0, start + seconds);
		oscillator.connect(gain).connect(context.destination);
		const ended = new Promise<void>((resolve) => (oscillator.onended = () => resolve()));
		oscillator.start(start);
		oscillator.stop(start + seconds);
		await ended;
	} finally {
		await context.close();
	}
}
