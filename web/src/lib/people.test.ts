import { describe, expect, it } from 'vitest';
import type { PersonOut } from './api/types.js';
import { chosenPeople, keptPeople, shapeOf } from './people.js';

const person = (id: number, is_default = false): PersonOut => ({
	id,
	name: `p${id}`,
	note: '',
	is_default,
	created_at: '2026-11-23T10:00:00Z',
	take_count: 0
});
const people = [person(2, true), person(1), person(3), person(4), person(5)];

describe('the mark of a person', () => {
	it('is the circle for the default person and one of the others by when they were added', () => {
		expect(people.map((p) => shapeOf(people, p.id))).toEqual([
			'circle',
			'triangle',
			'rect',
			'pin',
			'triangle'
		]);
	});

	it('does not depend on who else is shown', () => {
		expect(shapeOf(people, 3)).toBe(shapeOf([...people].reverse(), 3));
	});

	it('is the circle for someone unknown', () => {
		expect(shapeOf(people, 99)).toBe('circle');
	});
});

describe('the people a view shows', () => {
	it('is the default person when nobody is chosen', () => {
		expect(chosenPeople(people, []).map((p) => p.id)).toEqual([2]);
	});

	it('is the chosen ones, in the order of the list', () => {
		expect(chosenPeople(people, ['3', '2']).map((p) => p.id)).toEqual([2, 3]);
	});

	it('falls back to the default person when the chosen are gone', () => {
		expect(chosenPeople(people, ['99']).map((p) => p.id)).toEqual([2]);
	});

	it('keeps nothing for the default person alone', () => {
		expect(keptPeople(people, ['2'])).toEqual([]);
		expect(keptPeople(people, [])).toEqual([]);
		expect(keptPeople(people, ['99'])).toEqual([]);
		expect(keptPeople(people, ['3'])).toEqual(['3']);
		expect(keptPeople(people, ['3', '2'])).toEqual(['2', '3']);
	});
});
