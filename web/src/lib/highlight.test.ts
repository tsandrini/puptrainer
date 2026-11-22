import { describe, expect, it } from 'vitest';
import { folded, hasWords, highlightParts, searchWords } from './highlight.js';

describe('search words', () => {
	it('folds case and accents, drops repeats, puts the longest first', () => {
		expect(searchWords('  Úryvek  ah úryvek čeština ')).toEqual(['cestina', 'uryvek', 'ah']);
		expect(searchWords('   ')).toEqual([]);
	});

	it('asks for every word, anywhere', () => {
		const text = folded('Reading, Czech · Attempt · Zahrada u řeky');
		expect(hasWords(text, searchWords('reky attempt'))).toBe(true);
		expect(hasWords(text, searchWords('reky everyday'))).toBe(false);
		expect(hasWords(text, [])).toBe(true);
	});
});

describe('marking the matches', () => {
	it('cuts a text into runs, keeping its own letters', () => {
		expect(highlightParts('Zahrada u Řeky', searchWords('reky zah'))).toEqual([
			{ text: 'Zah', hit: true },
			{ text: 'rada u ', hit: false },
			{ text: 'Řeky', hit: true }
		]);
	});

	it('joins matches that touch or overlap', () => {
		expect(highlightParts('attempt', ['att', 'tem'])).toEqual([
			{ text: 'attem', hit: true },
			{ text: 'pt', hit: false }
		]);
	});

	it('leaves a text alone without words, and gives nothing for no text', () => {
		expect(highlightParts('plain', [])).toEqual([{ text: 'plain', hit: false }]);
		expect(highlightParts('', ['a'])).toEqual([]);
	});
});
