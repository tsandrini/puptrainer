// The two targets of the training, pitch and resonance, and how every
// measurement stands to them: it belongs to one of them, it is a condition
// on both (a voice that stays clear and easy), or it is about the recording.

import type { MetricGroup, Reading, Shift } from './api/types.js';

export type Role = 'pitch' | 'resonance' | 'condition' | 'context';
/** The roles a voice is read on. */
export type Target = Exclude<Role, 'context'>;

/** What each group of the metric registry is about. */
export const ROLE: Record<MetricGroup, Role> = {
	pitch: 'pitch',
	range: 'pitch',
	resonance: 'resonance',
	quality: 'condition',
	recording: 'context'
};

export const TARGETS: Target[] = ['pitch', 'resonance', 'condition'];

/** The numbers of a reading by what they are about, in the order they are shown. */
export const SHIFTS: Record<Target, string[]> = {
	pitch: ['pitch_shift_st', 'lightness_shift_db'],
	resonance: ['brightness_pct', 'r1_shift_pct'],
	condition: ['level_shift_db', 'clarity_shift_db']
};

/** The ends of the strip a shift is drawn on, in its unit. */
export const SCALE: Record<string, [number, number]> = {
	brightness_pct: [-10, 30],
	r1_shift_pct: [-30, 40]
};

/** One number of a reading, if it has it. */
export const shiftOf = (reading: Reading | null | undefined, key: string): Shift | null =>
	reading?.shifts.find((shift) => shift.key === key) ?? null;
