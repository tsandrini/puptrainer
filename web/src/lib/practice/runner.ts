// A guided practice session as a state machine: a check-in, then each
// exercise's reps (recording, a comfort rating before any number is shown,
// the result), then a check-out. Pure functions over plain data, so the
// page only renders the state and sends events.

import type { Exercise, Feel, PracticeIn, Routine } from '../api/types.js';

/** One exercise of the session with its number of reps. */
export type Step = { exercise: Exercise; reps: number };

export type Phase = 'checkin' | 'intro' | 'recording' | 'rating' | 'result' | 'checkout' | 'done';

/** A rep that was kept: its take's client id and the comfort given. */
export type Rep = { step: number; rep: number; clientId: string; comfort: number | null };

export type RunState = {
	steps: Step[];
	/** Index into `steps`. */
	step: number;
	/** The current rep, from 1. */
	rep: number;
	phase: Phase;
	feel: Feel | null;
	reps: Rep[];
	/** Steps left out by the learner. */
	skipped: number[];
};

export type RunEvent =
	| { type: 'checkin'; feel: Feel | null }
	| { type: 'start' }
	| { type: 'stop' }
	| { type: 'cancel' }
	| { type: 'rate'; comfort: number | null; clientId: string }
	| { type: 'next' }
	| { type: 'skip' }
	| { type: 'end' }
	| { type: 'finish' };

/** The lowest comfort, "strained": the session offers to stop. */
export const STRAINED = 1;

/**
 * The steps of a session: a routine's, or a single exercise's.
 *
 * @param catalogue every exercise, by id
 * @returns the steps, leaving out routine steps whose exercise is missing
 */
export function planSteps(
	catalogue: Exercise[],
	routine: Routine | null,
	exercise: Exercise | null
): Step[] {
	if (exercise) return [{ exercise, reps: exercise.reps }];
	if (!routine) return [];
	return routine.steps.flatMap((s) => {
		const found = catalogue.find((e) => e.id === s.exercise);
		return found ? [{ exercise: found, reps: s.reps ?? found.reps }] : [];
	});
}

/** A session at its check-in. */
export const begin = (steps: Step[]): RunState => ({
	steps,
	step: 0,
	rep: 1,
	phase: steps.length ? 'checkin' : 'done',
	feel: null,
	reps: [],
	skipped: []
});

/** The step after the current one, or the check-out. */
function nextStep(state: RunState, skipped: boolean): RunState {
	const skips = skipped ? [...state.skipped, state.step] : state.skipped;
	if (state.step + 1 >= state.steps.length) return { ...state, skipped: skips, phase: 'checkout' };
	return { ...state, skipped: skips, step: state.step + 1, rep: 1, phase: 'intro' };
}

/**
 * The state after an event; an event that does not fit the phase changes nothing.
 */
export function advance(state: RunState, event: RunEvent): RunState {
	switch (event.type) {
		case 'checkin':
			return state.phase === 'checkin' ? { ...state, feel: event.feel, phase: 'intro' } : state;
		case 'start':
			return state.phase === 'intro' ? { ...state, phase: 'recording' } : state;
		case 'stop':
			return state.phase === 'recording' ? { ...state, phase: 'rating' } : state;
		case 'cancel':
			return state.phase === 'recording' || state.phase === 'rating'
				? { ...state, phase: 'intro' }
				: state;
		case 'rate':
			if (state.phase !== 'rating') return state;
			return {
				...state,
				phase: 'result',
				reps: [
					...state.reps,
					{ step: state.step, rep: state.rep, clientId: event.clientId, comfort: event.comfort }
				]
			};
		case 'next':
			if (state.phase !== 'result') return state;
			if (state.rep < state.steps[state.step].reps)
				return { ...state, rep: state.rep + 1, phase: 'intro' };
			return nextStep(state, false);
		case 'skip':
			return state.phase === 'intro' || state.phase === 'result'
				? nextStep(
						state,
						state.reps.every((r) => r.step !== state.step)
					)
				: state;
		case 'end':
			return state.phase === 'done' || state.phase === 'checkout'
				? state
				: { ...state, phase: 'checkout' };
		case 'finish':
			return state.phase === 'checkout' ? { ...state, phase: 'done' } : state;
	}
}

/** The rep just rated, if any. */
export const lastRep = (state: RunState): Rep | null =>
	state.phase === 'result' ? (state.reps.at(-1) ?? null) : null;

/** Whether the last rep was rated as strained. */
export const strained = (state: RunState) => lastRep(state)?.comfort === STRAINED;

/** What the button after a result leads to. */
export function upcoming(state: RunState): 'rep' | 'step' | 'checkout' {
	if (state.rep < (state.steps[state.step]?.reps ?? 0)) return 'rep';
	return state.step + 1 < state.steps.length ? 'step' : 'checkout';
}

/** The session as the API stores it. */
export function practiceBody(
	state: RunState,
	session: {
		routineRef: string | null;
		language: string;
		startedAt: Date;
		endedAt?: Date | null;
		comfortEnd?: number | null;
		lastingTension?: boolean | null;
		note?: string;
	}
): PracticeIn {
	return {
		routine_ref: session.routineRef,
		language: session.language,
		started_at: session.startedAt.toISOString(),
		ended_at: session.endedAt ? session.endedAt.toISOString() : null,
		feel_start: state.feel,
		comfort_end: session.comfortEnd ?? null,
		lasting_tension: session.lastingTension ?? null,
		note: session.note ?? ''
	};
}
