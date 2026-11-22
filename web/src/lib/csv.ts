// What a table or a chart shows, as a file to keep: comma-separated values
// that a spreadsheet opens, and the handing of a file to the browser.

export type CsvCell = string | number | boolean | null | undefined;

const cell = (value: CsvCell): string => {
	if (value === null || value === undefined) return '';
	const text = `${value}`;
	return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Rows as CSV text (RFC 4180: CRLF, quotes doubled); the first row is the header. */
export const toCsv = (rows: readonly (readonly CsvCell[])[]): string =>
	rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';

/** Hand a file to the browser to save. */
export function saveFile(
	name: string,
	content: string | Blob,
	type = 'text/csv;charset=utf-8'
): void {
	// NOTE: the BOM makes a spreadsheet read accents in a CSV right
	const blob =
		typeof content === 'string'
			? new Blob([type.startsWith('text/csv') ? '﻿' : '', content], { type })
			: content;
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A file name with today's date: `puptrainer-takes-2026-11-22.csv`. */
export const datedName = (what: string, extension: string, now = new Date()): string =>
	`puptrainer-${what}-${now.toISOString().slice(0, 10)}.${extension}`;
