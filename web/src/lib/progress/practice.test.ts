import { describe, expect, it } from 'vitest';
import type { PracticeOut, TakeOut } from '#lib/api/types.js';
import { dailyMinutes, minutesOf, sessionFacts } from './practice.js';

const at = (day: number, hour: number, minute = 0) =>
	new Date(2026, 10, day, hour, minute).toISOString();
const session = (id: string, values: Partial<PracticeOut>): PracticeOut => ({
	id,
	routine_ref: 'routine:resonance@2',
	language: 'en',
	started_at: at(20, 10),
	ended_at: null,
	feel_start: 'normal',
	comfort_end: null,
	lasting_tension: null,
	note: '',
	take_count: 0,
	last_take_at: null,
	...values
});
const take = (session_id: string, met: boolean | null, recorded_at = at(20, 10, 1)) =>
	({ session_id, recorded_at, evaluation: met === null ? null : { met } }) as unknown as TakeOut;

describe('how long a session was practised for', () => {
	it('runs from its start to a little after its last take', () => {
		expect(
			minutesOf(
				session('a', { ended_at: at(20, 10, 12), last_take_at: at(20, 10, 11), take_count: 3 })
			)
		).toBe(12);
	});

	it('does not count the hour a session was left open after its last take', () => {
		expect(
			minutesOf(
				session('a', { ended_at: at(20, 11, 40), last_take_at: at(20, 10, 20), take_count: 5 })
			)
		).toBe(22);
		expect(minutesOf(session('a', { last_take_at: at(20, 10, 5), take_count: 1 }))).toBe(7);
	});

	it('does not count the hour a session was open before anything was recorded', () => {
		const late = session('a', {
			ended_at: at(20, 11, 40),
			last_take_at: at(20, 11, 38),
			take_count: 4
		});
		expect(minutesOf(late, at(20, 11, 30))).toBe(11);
		// a first take right at the start does not reach back before it
		expect(minutesOf(late, at(20, 10, 0))).toBe(100);
	});

	it('is nothing without a take', () => {
		expect(minutesOf(session('a', { ended_at: at(20, 10, 30) }))).toBe(0);
	});
});

describe('sessions as facts', () => {
	it('counts the judged takes and those that met their bar, oldest session first', () => {
		const facts = sessionFacts(
			[
				session('late', {
					started_at: at(21, 9),
					take_count: 2,
					last_take_at: at(21, 9, 4),
					comfort_end: 3
				}),
				session('early', { take_count: 3, last_take_at: at(20, 10, 8), lasting_tension: true })
			],
			[take('early', true), take('early', false), take('early', null), take('late', true)]
		);
		expect(facts.map((f) => f.id)).toEqual(['early', 'late']);
		expect(facts[0]).toMatchObject({
			judged: 2,
			met: 1,
			tension: true,
			routine: 'routine:resonance'
		});
		expect(facts[1]).toMatchObject({ judged: 1, met: 1, comfort: 3 });
	});
});

describe('practice day by day', () => {
	it('has every day from the first to the last, and a row per routine', () => {
		const facts = sessionFacts(
			[
				session('a', { started_at: at(19, 18), last_take_at: at(19, 18, 8), take_count: 2 }),
				session('b', {
					started_at: at(19, 20),
					last_take_at: at(19, 20, 3),
					take_count: 1,
					routine_ref: null
				}),
				session('c', { started_at: at(22, 11), last_take_at: at(22, 11, 20), take_count: 7 }),
				session('empty', { started_at: at(23, 11) })
			],
			[]
		);
		const { days, routines } = dailyMinutes(facts);
		expect(days).toHaveLength(4);
		expect(routines).toEqual([
			{ routine: 'routine:resonance', values: [10, 0, 0, 22] },
			{ routine: null, values: [5, 0, 0, 0] }
		]);
	});

	it('is empty when nothing was practised', () => {
		expect(dailyMinutes([])).toEqual({ days: [], routines: [] });
	});
});
