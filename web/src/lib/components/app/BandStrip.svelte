<script lang="ts">
	// The pitch band on a strip with the live pitch as a marker, and the
	// note to match as a line when there is one: a tuner. On a semitone
	// scale with a margin either side; a pitch beyond it rests at the edge.
	// A guide while recording; nothing of it is stored.
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { midiOf, noteName } from '#lib/practice/notes.js';

	let {
		low,
		high,
		pitch,
		note = null
	}: { low: number; high: number; pitch: number | null; note?: number | null } = $props();

	const MARGIN = 7; // semitones either side of the band
	const from = $derived(midiOf(low) - MARGIN);
	const span = $derived(midiOf(high) + MARGIN - from);
	const at = (hz: number) => Math.min(100, Math.max(0, ((midiOf(hz) - from) / span) * 100));
	/** On the note within half a semitone, or else inside the band. */
	const on = $derived(
		pitch !== null &&
			(note !== null
				? Math.abs(midiOf(pitch) - midiOf(note)) <= 0.5
				: pitch >= low && pitch <= high)
	);
</script>

<div data-testid="band-strip" data-on={on}>
	<div class="relative h-7 overflow-hidden rounded-full bg-muted">
		<div
			class="absolute inset-y-0 border-x border-primary/50 bg-chart-band"
			style="left: {at(low)}%; width: {at(high) - at(low)}%"
		></div>
		{#if note !== null}
			<div
				class="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-primary"
				style="left: {at(note)}%"
				data-testid="note-line"
			></div>
		{/if}
		{#if pitch !== null}
			<div
				class="absolute top-0.5 bottom-0.5 w-2 -translate-x-1/2 rounded-full transition-[left] duration-75 {on
					? 'bg-good'
					: 'bg-foreground/60'}"
				style="left: {at(pitch)}%"
			></div>
		{/if}
	</div>
	<div class="relative mt-0.5 h-4 text-xs text-muted-foreground tabular-nums">
		<span class="absolute -translate-x-1/2" style="left: {at(low)}%">{noteName(low)}</span>
		<span class="absolute -translate-x-1/2" style="left: {at(high)}%">{noteName(high)}</span>
	</div>
	<p class="text-sm tabular-nums" data-testid="strip-pitch">
		{#if pitch !== null}
			{i18n.t.practice.run.you(`${Math.round(pitch)} Hz, ${noteName(pitch)}`)}
		{:else}
			<span class="text-muted-foreground">{i18n.t.practice.run.youSilent}</span>
		{/if}
	</p>
</div>
