import { describe, expect, it } from 'vitest';
import { decodeView, encodeView, mentionsView } from './view.js';

const defaults = {
	search: '',
	voice: [] as string[],
	size: 25,
	practice: false,
	sort: '-recorded'
};

describe('a view as a query', () => {
	it('writes only what differs from the defaults', () => {
		expect(encodeView({ ...defaults }, defaults)).toBe('');
		expect(
			encodeView({ ...defaults, search: 'garden', voice: ['attempt', 'drill'], size: 50 }, defaults)
		).toBe('search=garden&voice=attempt%2Cdrill&size=50');
		expect(encodeView({ ...defaults, practice: true }, defaults)).toBe('practice=1');
	});

	it('reads it back, and falls back where the query is silent or wrong', () => {
		const view = { ...defaults, search: 'a b', voice: ['attempt'], size: 100, practice: true };
		expect(decodeView(encodeView(view, defaults), defaults)).toEqual(view);
		expect(decodeView('size=many&other=1', defaults)).toEqual(defaults);
		expect(decodeView('voice=', { ...defaults, voice: ['attempt'] }).voice).toEqual([]);
	});

	it('does not hand out the defaults themselves', () => {
		const view = decodeView('', defaults);
		view.voice.push('attempt');
		expect(defaults.voice).toEqual([]);
	});

	it('knows whether a query is about it', () => {
		expect(mentionsView('a=1&b=2', defaults)).toBe(false);
		expect(mentionsView('a=1&size=50', defaults)).toBe(true);
	});
});
