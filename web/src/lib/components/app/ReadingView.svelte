<script lang="ts">
	// A take read against the learner's own everyday voice, by target: how
	// far the pitch moved, how far the resonance moved (on a strip, with the
	// scatter of the everyday takes and the conventions to read it by), and
	// what that cost in loudness and clarity. Descriptive: no verdict.
	import type { Reading, Shift } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { SCALE, shiftOf } from '#lib/targets.js';
	import ShiftStrip from './ShiftStrip.svelte';

	let {
		reading,
		metrics,
		text = false
	}: {
		reading: Reading;
		/** The take's own metrics, for the values behind the shifts. */
		metrics: Record<string, number>;
		/** The take reads a text, which could be recorded in the everyday voice too. */
		text?: boolean;
	} = $props();

	const pitch = $derived(shiftOf(reading, 'pitch_shift_st'));
	const bright = $derived(shiftOf(reading, 'brightness_pct'));
	const first = $derived(shiftOf(reading, 'r1_shift_pct'));
	const cost = $derived(
		['level_shift_db', 'clarity_shift_db'].flatMap((key) => shiftOf(reading, key) ?? [])
	);

	const def = (key: string) => app.measures.find((measure) => measure.key === key);
	const title = (key: string) => i18n.pick(def(key)?.titles) || key;
	function amount(shift: Shift): string {
		const unit = def(shift.key)?.unit ?? '';
		const text = fmtSigned(shift.value, def(shift.key)?.decimals ?? 1, i18n.locale);
		return unit ? `${text} ${unit}` : text;
	}
	const hz = (value: number) => `${fmtNumber(value, 0, i18n.locale)} Hz`;
	/** The scatter of the everyday takes, in the shift's own unit. */
	function scatter(shift: Shift): string | null {
		if (shift.wobble === null) return null;
		const decimals = def(shift.key)?.decimals ?? 1;
		return i18n.t.reading.scatter(
			`${fmtNumber(shift.wobble, Math.max(1, decimals), i18n.locale)} ${def(shift.key)?.unit ?? ''}`
		);
	}
</script>

<section class="panel space-y-3" data-testid="reading" data-basis={reading.basis}>
	<div>
		<h2 class="text-base">{i18n.t.reading.title}</h2>
		<p class="text-xs text-muted-foreground">
			{i18n.t.reading.basis[reading.basis](reading.takes)}
		</p>
	</div>

	<div class="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
		{#if pitch}
			<div data-target="pitch">
				<div class="flex items-baseline justify-between gap-3">
					<h3 class="text-sm font-bold">{i18n.t.targets.pitch}</h3>
					<span class="text-lg font-extrabold tabular-nums" data-shift="pitch_shift_st">
						{amount(pitch)}
					</span>
				</div>
				<p class="text-xs text-muted-foreground tabular-nums">
					{#if metrics.pitch_median_hz}{hz(metrics.pitch_median_hz)} ·
					{/if}
					{#if pitch.everyday !== null}{i18n.t.reading.everyday(hz(pitch.everyday))}{/if}
					{#if scatter(pitch)}
						· {scatter(pitch)}{/if}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{i18n.pick(def('pitch_shift_st')?.descriptions)}
				</p>
			</div>
		{/if}

		<div data-target="resonance">
			<div class="flex items-baseline justify-between gap-3">
				<h3 class="text-sm font-bold">{i18n.t.targets.resonance}</h3>
				{#if bright}
					<span class="text-lg font-extrabold tabular-nums" data-shift="brightness_pct">
						{amount(bright)}
					</span>
				{/if}
			</div>
			{#if bright}
				<div class="mt-1">
					<ShiftStrip
						value={bright.value}
						wobble={bright.wobble}
						zones={def('brightness_pct')?.zones ?? []}
						range={SCALE.brightness_pct}
						label={title('brightness_pct')}
					/>
				</div>
				{#if scatter(bright)}
					<p class="mt-1 text-xs text-muted-foreground tabular-nums">{scatter(bright)}</p>
				{/if}
				{#if first}
					<p class="mt-1 text-sm tabular-nums">
						<span class="font-semibold">{title('r1_shift_pct')}:</span>
						<span class="font-extrabold" data-shift="r1_shift_pct">{amount(first)}</span>
						<span class="text-xs text-muted-foreground">
							{#if metrics.f1_median_hz}{hz(metrics.f1_median_hz)} ·
							{/if}
							{#if first.everyday !== null}{i18n.t.reading.everyday(hz(first.everyday))}{/if}
						</span>
					</p>
				{/if}
				<details class="mt-1 text-xs text-muted-foreground">
					<summary class="cursor-pointer"
						>{title('brightness_pct')}, {title('r1_shift_pct')}</summary
					>
					<p class="mt-1">{i18n.pick(def('brightness_pct')?.descriptions)}</p>
					<p class="mt-1">{i18n.pick(def('r1_shift_pct')?.descriptions)}</p>
				</details>
			{:else}
				<p class="mt-1 text-sm text-muted-foreground" data-testid="no-resonance">
					{#if reading.basis === 'speech'}
						{i18n.t.reading.noResonance}
						{#if text}{i18n.t.reading.recordText}{/if}
					{:else}
						{i18n.t.practice.advice['pitch-too-high']}
					{/if}
				</p>
			{/if}
		</div>
	</div>

	{#if cost.length}
		<div data-target="condition">
			<h3 class="text-sm font-bold">{i18n.t.targets.condition}</h3>
			<p class="text-sm tabular-nums">
				{#each cost as shift (shift.key)}
					<span class="mr-4 inline-block" title={i18n.pick(def(shift.key)?.descriptions)}>
						{title(shift.key)}:
						<span class="font-extrabold" data-shift={shift.key}>{amount(shift)}</span>
					</span>
				{/each}
			</p>
		</div>
	{/if}

	{#if metrics.clipped_samples > 0}
		<p class="text-sm text-warning" data-testid="reading-clipped">{i18n.t.reading.clipped}</p>
	{/if}
	{#if reading.notes.length}
		<ul class="space-y-1 text-sm" data-testid="reading-notes">
			{#each reading.notes as note (note)}
				<li data-note={note}>{i18n.t.reading.notes[note] ?? note}</li>
			{/each}
		</ul>
	{/if}
</section>
