<script lang="ts">
	// How a practice take went: the one or two numbers its exercise is
	// judged by, each against its range, met or not yet, and the exercise's
	// hints. Neutral colours: "not yet" is not a failure.
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { Evaluation, Measure } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { noteName } from '#lib/practice/notes.js';
	import { cn } from '#lib/utils.js';

	let { evaluation }: { evaluation: Evaluation } = $props();

	/** What to try next; the note's advice says how far off the voice was. */
	const advice = $derived(
		evaluation.advice.map((code) => {
			const off = evaluation.measures.find((m) => m.key === 'note_offset_st');
			const far = off ? fmtNumber(Math.abs(off.value), 0, i18n.locale) : '';
			if (code === 'above-note') return i18n.t.practice.advice.aboveNote(far);
			if (code === 'below-note') return i18n.t.practice.advice.belowNote(far);
			return i18n.t.practice.advice[code];
		})
	);
	const effortful = $derived(evaluation.advice.includes('effortful'));

	const unitOf = (key: string) => app.measure(key)?.unit ?? '';
	const decimalsOf = (key: string) => app.measure(key)?.decimals ?? 1;

	/** Measures that are a distance from something, shown with their sign. */
	const SIGNED = new Set(['step_bright_pct', 'step_r1_pct', 'step_dark_pct', 'note_offset_st']);

	function number(key: string, value: number): string {
		const unit = unitOf(key);
		const text = (SIGNED.has(key) ? fmtSigned : fmtNumber)(value, decimalsOf(key), i18n.locale);
		return unit ? `${text} ${unit}` : text;
	}

	function value(m: Measure): string {
		const text = number(m.key, m.value);
		return unitOf(m.key) === 'Hz' && m.value > 0 ? `${text} (${noteName(m.value)})` : text;
	}

	function range(m: Measure): string {
		const unit = unitOf(m.key);
		const at = (v: number) => fmtNumber(v, decimalsOf(m.key), i18n.locale);
		const suffix = unit ? ` ${unit}` : '';
		if (m.low !== null && m.high !== null) return `${at(m.low)}–${at(m.high)}${suffix}`;
		if (m.low !== null) return `≥ ${at(m.low)}${suffix}`;
		if (m.high !== null) return `≤ ${at(m.high)}${suffix}`;
		return '';
	}
</script>

<div class="space-y-2" data-testid="evaluation" data-met={evaluation.met}>
	{#if evaluation.problem}
		<p class="text-sm text-muted-foreground" data-testid="evaluation-problem">
			{i18n.t.practice.problems[evaluation.problem] ?? evaluation.problem}
		</p>
	{:else if evaluation.met !== null}
		<p
			class={cn(
				'flex items-center gap-1.5 text-lg font-extrabold',
				evaluation.met && !effortful ? 'text-good' : 'text-muted-foreground'
			)}
			data-testid="verdict"
		>
			{#if evaluation.met}<CheckIcon class="size-5" />{/if}
			{evaluation.met
				? effortful
					? i18n.t.practice.run.metWithEffort
					: i18n.t.practice.run.met
				: i18n.t.practice.run.notYet}
		</p>
		{#each advice as line (line)}
			<p class="text-sm" data-testid="advice">{line}</p>
		{/each}
		{#if evaluation.strained}
			<p class="text-sm text-muted-foreground" data-testid="strained-result">
				{i18n.t.practice.run.strainedResult}
			</p>
		{/if}
	{/if}
	{#if evaluation.measures.length}
		<dl class="divide-y text-sm">
			{#each evaluation.measures as m (m.key)}
				{@const def = app.measure(m.key)}
				<div class="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
					<dt class="font-semibold">{def ? i18n.pick(def.titles) : m.key}</dt>
					<dd class="flex items-baseline gap-2">
						<span class="font-extrabold tabular-nums" data-measure={m.key}>{value(m)}</span>
						{#if range(m)}
							<span
								class={cn(
									'text-xs tabular-nums',
									m.met === true ? 'text-good' : 'text-muted-foreground'
								)}>{range(m)}</span
							>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}
	{#if evaluation.hints.length}
		<div class="text-xs text-muted-foreground" title={i18n.t.practice.run.hintNote}>
			{#each evaluation.hints as h (h.key)}
				{@const def = app.measure(h.key)}
				<span class="mr-3 inline-block" data-hint={h.key}>
					{def ? i18n.pick(def.titles) : h.key}:
					<span class="font-semibold text-foreground tabular-nums">{number(h.key, h.value)}</span>
					({i18n.t.practice.run.hint})
				</span>
			{/each}
		</div>
	{/if}
</div>
