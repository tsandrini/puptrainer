// What a chart says about the take under the pointer: a small card built
// as elements (never as markup from a take's own text), styled inline so
// that it looks the same wherever the chart library puts it.

export type TipRow = { label: string; value: string; color?: string };

const el = (tag: string, style: string, text = ''): HTMLElement => {
	const node = document.createElement(tag);
	node.style.cssText = style;
	node.textContent = text;
	return node;
};

/** A tooltip card: a title, a line under it, rows of name and value, a note, a hint. */
export function tipCard(input: {
	title: string;
	sub?: string;
	rows?: TipRow[];
	note?: string;
	foot?: string;
}): HTMLElement {
	const card = el('div', 'display:flex;flex-direction:column;gap:4px;min-width:11rem;');
	card.dataset.testid = 'chart-tip';
	card.append(el('div', 'font-weight:800;', input.title));
	if (input.sub) card.append(el('div', 'opacity:.7;font-size:11px;white-space:normal;', input.sub));
	if (input.rows?.length) {
		const table = el(
			'div',
			'display:grid;grid-template-columns:auto 1fr auto;column-gap:8px;row-gap:1px;margin-top:2px;align-items:center;'
		);
		for (const row of input.rows) {
			table.append(
				el(
					'span',
					`width:8px;height:8px;border-radius:9999px;background:${row.color ?? 'transparent'};`
				),
				el('span', 'opacity:.75;', row.label),
				el('span', 'font-weight:700;font-variant-numeric:tabular-nums;text-align:right;', row.value)
			);
		}
		card.append(table);
	}
	if (input.note)
		card.append(
			el(
				'div',
				'opacity:.8;font-size:11px;font-style:italic;white-space:normal;max-width:20rem;',
				input.note
			)
		);
	if (input.foot)
		card.append(el('div', 'opacity:.55;font-size:10.5px;margin-top:2px;', input.foot));
	return card;
}
