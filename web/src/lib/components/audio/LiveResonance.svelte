<script lang="ts" module>
	import type { LiveReference } from '#lib/audio/reference.js';

	/**
	 * What a live resonance is counted from: the first sound of the take itself (held
	 * sounds and whispers, where the vowel is fixed), or the learner's everyday takes
	 * (`undefined` while they are being measured, `null` when there are none).
	 */
	export type Zero =
		{ from: 'start' } | { from: 'everyday'; reference: LiveReference | null | undefined };
</script>

<script lang="ts">
	// The resonance of what the microphone hears, live, on the strip a saved
	// take is read on: brightness (F2 to F4) and the first resonance, R1. A
	// guide while recording; nothing of it is stored. The page hands it the
	// recorder's blocks through `push`.
	import { app } from '#lib/app.svelte.js';
	import {
		MAX_PITCH_HZ,
		ResonanceTracker,
		brightnessPct,
		firstPct,
		type Formants,
		type Mode
	} from '#lib/audio/formants.js';
	import ShiftStrip from '#lib/components/app/ShiftStrip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { SCALE } from '#lib/targets.js';

	let {
		mode = 'voiced',
		zero,
		base = $bindable(null),
		set = $bindable(false),
		blurred = false
	}: {
		mode?: Mode;
		zero: Zero;
		/** What the readings are counted from, for what is drawn beside the meter. */
		base?: Formants | null;
		/** The zero was set by hand (`rezero`), not taken from the take's first sound. */
		set?: boolean;
		/**
		 * The voice is too light for its first resonance to be read (the live graph
		 * measures that): R1 is then said to be unreadable, not shown as a number.
		 */
		blurred?: boolean;
	} = $props();

	/**
	 * How much sound sets the zero of a take read against its own start. A whisper comes
	 * in short puffs, a quarter of a second each, so it gets by with less.
	 */
	// svelte-ignore state_referenced_locally
	const START_S = mode === 'whisper' ? 0.6 : 1;
	/** What "now" is: a held sound answers at once, speech needs a few words. */
	const WINDOW_S = { start: 1.5, everyday: 8 } as const;
	/** Blocks between two readings of the tracker: about four a second. */
	const EVERY = 6;

	type Shown = { bright: number; first: number };

	// svelte-ignore state_referenced_locally
	const tracker = new ResonanceTracker(mode, zero.from === 'start');
	let blocks = 0;
	let now = $state<Shown | null>(null);
	let whole = $state<Shown | null>(null);
	let heard = $state(0);
	let high = $state(false);
	/** A zero set by hand on a held sound: it replaces the take's first sound. */
	let manual = $state.raw<Formants | null>(null);

	// the everyday voice is a zero before the first block arrives
	$effect(() => {
		if (zero.from === 'everyday') base = zero.reference?.formants ?? null;
	});

	/** Puts the zero on the sound of the last second: what follows is counted from it. */
	export function rezero(): void {
		const here = tracker.recent(1);
		if (!here || zero.from !== 'start') return;
		manual = here;
		set = true;
	}

	const against = (formants: Formants | null, base: Formants | null): Shown | null =>
		formants && base
			? { bright: brightnessPct(formants, base), first: firstPct(formants, base) }
			: null;

	/**
	 * Takes in the next block of the recording.
	 *
	 * @param block samples in [-1, 1]
	 * @param sampleRate samples per second
	 * @param pitchHz the block's pitch, or null when it has none
	 */
	export function push(block: Float32Array, sampleRate: number, pitchHz: number | null): void {
		tracker.push(block, sampleRate, pitchHz);
		if (++blocks % EVERY) return;
		heard = tracker.heard;
		high = mode === 'voiced' && pitchHz !== null && pitchHz > MAX_PITCH_HZ;
		const from =
			zero.from === 'start'
				? (manual ?? tracker.opening(START_S))
				: (zero.reference?.formants ?? null);
		base = from;
		now = against(tracker.recent(WINDOW_S[zero.from]), from);
		whole = zero.from === 'everyday' ? against(tracker.whole(), from) : null;
	}

	const measure = (key: string) => app.measures.find((m) => m.key === key);
	const percent = (value: number) => `${fmtSigned(value, 0, i18n.locale)} %`;
	/** The number the strip's marker stands for: the take so far in speech, the moment in a hold. */
	const main = $derived(zero.from === 'everyday' ? whole : now);
	const status = $derived.by(() => {
		if (zero.from === 'everyday' && zero.reference === undefined) return i18n.t.live.preparing;
		if (zero.from === 'everyday' && zero.reference === null) return i18n.t.live.none;
		if (high) return i18n.t.live.tooHigh;
		if (zero.from === 'start' && heard < START_S)
			return i18n.t.live.settingZero(
				fmtNumber(heard, 1, i18n.locale),
				fmtNumber(START_S, 1, i18n.locale)
			);
		return main ? null : i18n.t.live.waiting;
	});
	const counted = $derived(
		zero.from === 'start'
			? manual
				? i18n.t.live.fromSet
				: i18n.t.live.fromStart
			: zero.reference?.basis === 'same-kind'
				? i18n.t.live.fromKind
				: zero.reference
					? i18n.t.live.fromEveryday
					: ''
	);
</script>

<div class="space-y-1" data-testid="live-resonance" data-from={zero.from} data-mode={mode}>
	<div class="flex flex-wrap items-baseline justify-between gap-x-4">
		<span class="text-sm font-bold">{i18n.t.live.title}</span>
		<span class="text-sm tabular-nums" data-testid="live-brightness">
			{#if main}
				{i18n.t.live.brightness}
				<span class="text-lg font-extrabold">{percent(main.bright)}</span>
				· {i18n.t.live.first}
				{#if blurred}
					<span class="text-muted-foreground" data-testid="live-r1-unreadable">
						{i18n.t.traces.unreadable}
					</span>
				{:else}
					<span class="font-extrabold">{percent(main.first)}</span>
				{/if}
			{:else}
				<span class="text-muted-foreground">{i18n.t.common.none}</span>
			{/if}
		</span>
	</div>
	<ShiftStrip
		value={main?.bright ?? null}
		ghost={zero.from === 'everyday' ? (now?.bright ?? null) : null}
		zones={measure('brightness_pct')?.zones ?? []}
		range={SCALE.brightness_pct}
		label={i18n.t.live.brightness}
	/>
	{#if zero.from === 'start'}
		<div class="pt-1">
			<p class="text-xs font-semibold">{i18n.pick(measure('r1_shift_pct')?.titles)}</p>
			<ShiftStrip
				value={blurred ? null : (now?.first ?? null)}
				zones={measure('r1_shift_pct')?.zones ?? []}
				range={SCALE.r1_shift_pct}
				label={i18n.t.live.first}
			/>
		</div>
	{/if}
	{#if zero.from === 'start'}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
			<Button
				variant="outline"
				size="sm"
				disabled={!now}
				onclick={rezero}
				data-testid="set-zero"
				data-set={manual !== null}
			>
				{i18n.t.live.setZero}
			</Button>
			<span class="text-xs text-muted-foreground">{i18n.t.live.setZeroHint}</span>
		</div>
	{/if}
	<p class="text-xs text-muted-foreground" data-testid="live-status">
		{#if status}
			<span class="font-semibold text-foreground">{status}</span>
		{:else if zero.from === 'everyday' && now}
			{i18n.t.live.soFar}: {percent(main?.bright ?? 0)} · {i18n.t.live.recent(WINDOW_S.everyday)}:
			{percent(now.bright)}.
		{/if}
		{counted}
		{i18n.t.live.caption}
	</p>
</div>
