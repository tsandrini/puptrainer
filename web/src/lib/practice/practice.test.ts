import { describe, expect, it } from 'vitest';
import type { Exercise, Routine } from '../api/types.js';
import { midiOf, noteName, notesIn, pickNote } from './notes.js';
import {
	advance,
	begin,
	planSteps,
	practiceBody,
	strained,
	upcoming,
	type RunState
} from './runner.js';

const exercise = (id: string, reps: number) => ({ id, reps, version: 1 }) as unknown as Exercise;
const catalogue = [exercise('slide', 3), exercise('count', 1)];
const routine = {
	id: 'quick',
	version: 1,
	steps: [{ exercise: 'slide', reps: 2 }, { exercise: 'gone' }, { exercise: 'count' }]
} as unknown as Routine;

/** Records and rates one rep. */
const rep = (state: RunState, comfort: number | null, id: string) =>
	advance(advance(advance(state, { type: 'start' }), { type: 'stop' }), {
		type: 'rate',
		comfort,
		clientId: id
	});

describe('notes', () => {
	it('names notes and finds those inside a band', () => {
		expect(noteName(440)).toBe('A4');
		expect(noteName(196)).toBe('G3');
		expect(noteName(185)).toBe('F♯3');
		expect(midiOf(220)).toBeCloseTo(57);
		expect(notesIn(174, 220).map(noteName)).toEqual(['F3', 'F♯3', 'G3', 'G♯3', 'A3']);
		expect(notesIn(200, 205)).toEqual([]);
	});

	it('picks a different note each time when it can', () => {
		const first = pickNote(174, 220, null, () => 0);
		expect(noteName(first)).toBe('F3');
		expect(noteName(pickNote(174, 220, first, () => 0))).toBe('F♯3');
		expect(noteName(pickNote(174, 220, first, () => 0.999))).toBe('A3');
		expect(pickNote(200, 205)).toBeCloseTo(Math.sqrt(200 * 205));
	});
});

describe('the session runner', () => {
	it('plans a routine, overriding reps and leaving out missing exercises', () => {
		const steps = planSteps(catalogue, routine, null);
		expect(steps.map((s) => [s.exercise.id, s.reps])).toEqual([
			['slide', 2],
			['count', 1]
		]);
		expect(planSteps(catalogue, null, catalogue[0]).map((s) => s.reps)).toEqual([3]);
		expect(begin([]).phase).toBe('done');
	});

	it('walks check-in, reps, steps and check-out', () => {
		let state = begin(planSteps(catalogue, routine, null));
		expect(state.phase).toBe('checkin');
		expect(advance(state, { type: 'start' })).toBe(state);
		state = advance(state, { type: 'checkin', feel: 'fresh' });
		expect([state.phase, state.feel]).toEqual(['intro', 'fresh']);

		state = rep(state, 4, 'a');
		expect(state.phase).toBe('result');
		expect(upcoming(state)).toBe('rep');
		state = advance(state, { type: 'next' });
		expect([state.step, state.rep, state.phase]).toEqual([0, 2, 'intro']);

		// a discarded recording is not a rep
		state = advance(advance(state, { type: 'start' }), { type: 'cancel' });
		expect([state.rep, state.phase, state.reps.length]).toEqual([2, 'intro', 1]);

		state = rep(state, 5, 'b');
		expect(upcoming(state)).toBe('step');
		state = advance(state, { type: 'next' });
		expect([state.step, state.rep]).toEqual([1, 1]);
		state = rep(state, null, 'c');
		expect(upcoming(state)).toBe('checkout');
		state = advance(state, { type: 'next' });
		expect(state.phase).toBe('checkout');
		state = advance(state, { type: 'finish' });
		expect(state.phase).toBe('done');
		expect(state.reps.map((r) => [r.step, r.rep, r.clientId, r.comfort])).toEqual([
			[0, 1, 'a', 4],
			[0, 2, 'b', 5],
			[1, 1, 'c', null]
		]);
		expect(state.skipped).toEqual([]);
	});

	it('offers to stop after a strained rep, and can skip or end', () => {
		let state = advance(begin(planSteps(catalogue, routine, null)), {
			type: 'checkin',
			feel: null
		});
		state = rep(state, 1, 'a');
		expect(strained(state)).toBe(true);
		const skipped = advance(state, { type: 'skip' });
		expect([skipped.step, skipped.phase, skipped.skipped]).toEqual([1, 'intro', []]);
		const untouched = advance(skipped, { type: 'skip' });
		expect([untouched.phase, untouched.skipped]).toEqual(['checkout', [1]]);
		expect(advance(state, { type: 'end' }).phase).toBe('checkout');
	});

	it('describes the session for the API', () => {
		const state = advance(begin(planSteps(catalogue, routine, null)), {
			type: 'checkin',
			feel: 'tired'
		});
		const started = new Date('2026-11-18T08:00:00Z');
		expect(
			practiceBody(state, { routineRef: 'routine:quick@1', language: 'cs', startedAt: started })
		).toEqual({
			routine_ref: 'routine:quick@1',
			language: 'cs',
			started_at: '2026-11-18T08:00:00.000Z',
			ended_at: null,
			feel_start: 'tired',
			comfort_end: null,
			lasting_tension: null,
			note: ''
		});
	});
});
