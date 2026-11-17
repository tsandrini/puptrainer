// Notes in equal temperament (A4 = 440 Hz): names for pitches, the notes
// inside a band, and a note to match for the note-matching drill.

const A4_HZ = 440;
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A common band to start in, from the teachers' material (F3 to A3); a convention, not a goal. */
export const STARTING_BAND = { low_hz: 174, high_hz: 220 } as const;

/** The MIDI number of a pitch, fractional between notes (A4 = 69). */
export const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / A4_HZ);

/** The pitch of a MIDI note number. */
export const hzOf = (midi: number) => A4_HZ * 2 ** ((midi - 69) / 12);

/** The name of the note nearest to a pitch, in scientific pitch notation: `G3`. */
export function noteName(hz: number): string {
	const midi = Math.round(midiOf(hz));
	return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** The notes (Hz) whose pitch lies inside `low`..`high`, lowest first. */
export function notesIn(low: number, high: number): number[] {
	const out: number[] = [];
	for (let midi = Math.ceil(midiOf(low) - 1e-9); midi <= Math.floor(midiOf(high) + 1e-9); midi++)
		out.push(hzOf(midi));
	return out;
}

/**
 * A note from a band to match, a different one from last time when there is a choice.
 *
 * @param low lower edge of the band, Hz
 * @param high upper edge, Hz
 * @param previous the note played last time, if any
 * @param random a number in [0, 1), for tests
 * @returns the note in Hz; the band's middle when it holds no whole note
 */
export function pickNote(
	low: number,
	high: number,
	previous: number | null = null,
	random: () => number = Math.random
): number {
	const notes = notesIn(low, high);
	if (notes.length === 0) return Math.sqrt(low * high);
	const choices =
		notes.length > 1 && previous !== null
			? notes.filter((n) => Math.abs(n - previous) > 0.5)
			: notes;
	return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
