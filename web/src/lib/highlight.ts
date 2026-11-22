// Search as a person types it: words in any order, in any case, with or
// without the accents; and a text cut into the runs that matched, so a
// table can mark them.

export type Part = { text: string; hit: boolean };

/** A text without case and accents, with where each of its characters came from. */
function fold(text: string): { folded: string; from: number[] } {
	let folded = '';
	const from: number[] = [];
	for (let index = 0; index < text.length; index++) {
		const plain = text[index].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
		for (const char of plain) {
			folded += char;
			from.push(index);
		}
	}
	return { folded, from };
}

/** A text as search sees it: lowercased, accents dropped. */
export const folded = (text: string): string => fold(text).folded;

/** The words of a search: folded, each once, the longest first. */
export function searchWords(query: string): string[] {
	const words = folded(query).split(/\s+/).filter(Boolean);
	return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** Whether a folded text has every word of a search. */
export const hasWords = (text: string, words: readonly string[]): boolean =>
	words.every((word) => text.includes(word));

/** A text as runs that match one of the words and runs that do not; touching matches are one run. */
export function highlightParts(text: string, words: readonly string[]): Part[] {
	if (!text || !words.length) return text ? [{ text, hit: false }] : [];
	const { folded: plain, from } = fold(text);
	const hit = new Array<boolean>(text.length).fill(false);
	for (const word of words) {
		if (!word) continue;
		for (let at = plain.indexOf(word); at !== -1; at = plain.indexOf(word, at + 1))
			for (let index = at; index < at + word.length; index++) hit[from[index]] = true;
	}
	const parts: Part[] = [];
	for (let index = 0; index < text.length; index++) {
		const last = parts[parts.length - 1];
		if (last && last.hit === hit[index]) last.text += text[index];
		else parts.push({ text: text[index], hit: hit[index] });
	}
	return parts;
}
