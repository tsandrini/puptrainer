import { describe, expect, it } from 'vitest';
import type { Passage } from './api/types.js';
import { guessLabels, passageFor, passageRef } from './labels.js';

const passages: Passage[] = [
	{ id: 'garden-en', language: 'en', version: 1, title: '', text: '' },
	{ id: 'garden-en', language: 'en', version: 2, title: '', text: '' },
	{ id: 'garden-cs', language: 'cs', version: 1, title: '', text: '' }
];

describe('guessLabels', () => {
	it('reads the baseline naming', () => {
		expect(guessLabels('2026-11-16_passage-cs_habitual.wav', passages)).toEqual({
			item: 'passage',
			intent: 'habitual',
			language: 'cs',
			contentRef: 'passage:garden-cs@1',
			date: '2026-11-16'
		});
		expect(guessLabels('/home/x/2026-11-16_free-en_attempt.flac', passages)).toEqual({
			item: 'free',
			intent: 'attempt',
			language: 'en',
			contentRef: null,
			date: '2026-11-16'
		});
		expect(guessLabels('2026-11-16_vowels_habitual.wav')).toMatchObject({
			item: 'vowels',
			language: null
		});
		expect(guessLabels('2026-11-16_glide_habitual.wav').item).toBe('glide');
	});

	it('takes the newest version of a passage', () => {
		expect(guessLabels('passage-en.wav', passages).contentRef).toBe('passage:garden-en@2');
		expect(passageFor(passages, 'de')).toBeNull();
		expect(passageRef(passages[2])).toBe('passage:garden-cs@1');
	});

	it('falls back when the name says nothing', () => {
		expect(guessLabels('Recording 12.wav')).toEqual({
			item: 'other',
			intent: 'habitual',
			language: null,
			contentRef: null,
			date: null
		});
		expect(guessLabels('2026-11-16_vowels.wav')).toMatchObject({
			item: 'vowels',
			intent: 'habitual',
			date: '2026-11-16'
		});
	});
});
