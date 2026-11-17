<script lang="ts">
	// The pitch band on a strip with the live pitch as a marker, on a
	// semitone scale with a margin either side. A guide while recording;
	// nothing of it is stored.
	import { midiOf, noteName } from '#lib/practice/notes.js';

	let { low, high, pitch }: { low: number; high: number; pitch: number | null } = $props();

	const MARGIN = 5; // semitones either side of the band
	const from = $derived(midiOf(low) - MARGIN);
	const span = $derived(midiOf(high) + MARGIN - from);
	const at = (hz: number) => Math.min(100, Math.max(0, ((midiOf(hz) - from) / span) * 100));
	const inside = $derived(pitch !== null && pitch >= low && pitch <= high);
</script>

<div data-testid="band-strip">
	<div class="relative h-6 overflow-hidden rounded-full bg-muted">
		<div
			class="absolute inset-y-0 border-x border-primary/50 bg-chart-band"
			style="left: {at(low)}%; width: {at(high) - at(low)}%"
		></div>
		{#if pitch !== null}
			<div
				class="absolute top-0.5 bottom-0.5 w-1.5 -translate-x-1/2 rounded-full transition-[left] duration-75 {inside
					? 'bg-primary'
					: 'bg-foreground/50'}"
				style="left: {at(pitch)}%"
			></div>
		{/if}
	</div>
	<div class="relative mt-0.5 h-4 text-xs text-muted-foreground tabular-nums">
		<span class="absolute -translate-x-1/2" style="left: {at(low)}%">{noteName(low)}</span>
		<span class="absolute -translate-x-1/2" style="left: {at(high)}%">{noteName(high)}</span>
	</div>
</div>
