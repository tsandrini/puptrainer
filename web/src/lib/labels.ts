// Labels read off a recording's file name, for the import screen:
// `2026-11-16_passage-en_habitual.wav` says the date, what was spoken, the
// language and which voice it was.

import type { Exercise, Intent, Item, Passage, Routine } from './api/types.js';

export type Guess = {
	item: Item;
	intent: Intent;
	language: string | null;
	contentRef: string | null;
	date: string | null;
};

const ITEMS: Item[] = ['vowels', 'glide', 'sustain', 'phrase', 'passage', 'free', 'other'];
const INTENTS: Intent[] = ['habitual', 'attempt', 'drill'];

/** The reference a take stores for a passage: `passage:garden-en@1`. */
export const passageRef = (passage: Passage) => `passage:${passage.id}@${passage.version}`;

/** The reference a practice take stores for its exercise: `exercise:note-match@1`. */
export const exerciseRef = (exercise: Exercise) => `exercise:${exercise.id}@${exercise.version}`;

/** The reference a practice session stores for its routine: `routine:starter@1`. */
export const routineRef = (routine: Routine) => `routine:${routine.id}@${routine.version}`;

/** The newest passage in a language, if any. */
export function passageFor(passages: Passage[], language: string | null): Passage | null {
	const matches = passages.filter((p) => p.language === language);
	return matches.sort((a, b) => b.version - a.version)[0] ?? null;
}

/**
 * Guesses a file's labels from its name.
 *
 * @param name the file name, with or without directories and extension
 * @param passages the known passages, to attach the text a `passage-<lang>` file read
 * @returns the labels found; what the name does not say defaults to `other`, `habitual`
 *   and no language
 */
export function guessLabels(name: string, passages: Passage[] = []): Guess {
	const stem = name.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
	const parts = stem.toLowerCase().split('_');
	const guess: Guess = {
		item: 'other',
		intent: 'habitual',
		language: null,
		contentRef: null,
		date: null
	};
	for (const part of parts) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(part)) {
			guess.date = part;
			continue;
		}
		if (INTENTS.includes(part as Intent)) {
			guess.intent = part as Intent;
			continue;
		}
		const [kind, language] = part.split('-');
		if (ITEMS.includes(kind as Item)) {
			guess.item = kind as Item;
			if (language && /^[a-z]{2,3}$/.test(language)) guess.language = language;
		}
	}
	if (guess.item === 'passage') {
		const passage = passageFor(passages, guess.language);
		if (passage) guess.contentRef = passageRef(passage);
	}
	return guess;
}
