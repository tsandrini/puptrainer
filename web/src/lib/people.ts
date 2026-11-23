// People in lists and on charts: the mark each one keeps, and who a view shows.
import type { PersonOut } from './api/types.js';

/** A chart mark; the default person's is the circle. (A diamond is a drill's.) */
export type Shape = 'circle' | 'triangle' | 'rect' | 'pin';
/** The marks of everyone but the default person, in the order they were added; then again. */
export const SHAPES: Shape[] = ['triangle', 'rect', 'pin'];

/**
 * The mark a person keeps on every chart. It follows when they were added, not who is
 * shown at the moment, so a person looks the same wherever they appear.
 */
export function shapeOf(people: readonly PersonOut[], id: number): Shape {
	const person = people.find((p) => p.id === id);
	if (!person || person.is_default) return 'circle';
	const others = people.filter((p) => !p.is_default).sort((a, b) => a.id - b.id);
	return SHAPES[others.findIndex((p) => p.id === id) % SHAPES.length];
}

/**
 * The people a view shows: the ones chosen, or the default person when nobody is
 * chosen (or none of the chosen exists any more).
 *
 * @param chosen Ids as a view keeps them: strings.
 */
export function chosenPeople(people: readonly PersonOut[], chosen: readonly string[]): PersonOut[] {
	const picked = people.filter((p) => chosen.includes(`${p.id}`));
	return picked.length ? picked : people.filter((p) => p.is_default);
}

/**
 * What a view keeps for a choice of people: nothing when it is the default person
 * alone, so that the default view follows whoever the default person is.
 */
export function keptPeople(people: readonly PersonOut[], chosen: readonly string[]): string[] {
	const picked = chosenPeople(people, chosen);
	return picked.length === 1 && picked[0].is_default ? [] : picked.map((p) => `${p.id}`);
}
