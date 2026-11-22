import { describe, expect, it } from 'vitest';
import { datedName, toCsv } from './csv.js';

describe('CSV', () => {
	it('quotes what needs it and leaves the rest', () => {
		expect(
			toCsv([
				['Recorded', 'Note', 'Pitch'],
				['2026-11-21', 'said "ah", twice', 212.5],
				['2026-11-22', 'two\nlines', null]
			])
		).toBe(
			'Recorded,Note,Pitch\r\n2026-11-21,"said ""ah"", twice",212.5\r\n2026-11-22,"two\nlines",\r\n'
		);
	});

	it('names a file by what and when', () => {
		expect(datedName('takes', 'csv', new Date('2026-11-22T10:00:00Z'))).toBe(
			'puptrainer-takes-2026-11-22.csv'
		);
	});
});
