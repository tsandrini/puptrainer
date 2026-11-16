<script lang="ts">
	// The recording level: a bar from -60 to 0 dBFS with the target zone
	// (-12 to -6) marked; the fill is the block's peak.
	import { TARGET_DB, meterPosition } from '#lib/audio/meter.js';
	import { cn } from '#lib/utils.js';

	let { peakDb, clipping = false }: { peakDb: number; clipping?: boolean } = $props();

	const fill = $derived(meterPosition(peakDb) * 100);
	const zoneLeft = meterPosition(TARGET_DB.low) * 100;
	const zoneWidth = (meterPosition(TARGET_DB.high) - meterPosition(TARGET_DB.low)) * 100;
	const state = $derived(
		clipping || peakDb > TARGET_DB.high + 3
			? 'bg-critical'
			: peakDb >= TARGET_DB.low
				? 'bg-good'
				: 'bg-foreground/60'
	);
</script>

<div
	class="relative h-4 overflow-hidden rounded-sm bg-muted"
	role="meter"
	aria-valuemin={-60}
	aria-valuemax={0}
	aria-valuenow={Math.round(peakDb)}
	data-testid="meter"
>
	<div
		class="absolute inset-y-0 border-x border-good/60 bg-good/15"
		style="left: {zoneLeft}%; width: {zoneWidth}%"
	></div>
	<div
		class={cn('absolute inset-y-0 left-0 transition-[width] duration-75', state)}
		style="width: {fill}%"
	></div>
</div>
