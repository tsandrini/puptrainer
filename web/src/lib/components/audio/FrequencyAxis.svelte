<script lang="ts">
	// The frequency scale laid over a spectrogram: a faint line and a label
	// per kilohertz. Sits inside a `relative` box the picture fills.
	import { MAX_HZ, layoutHeight } from '#lib/audio/spectrum.js';
	import { LAYOUT } from '#lib/audio/view.svelte.js';

	const total = layoutHeight(LAYOUT);
	/** Distance of a frequency from the picture's bottom, in percent. */
	const bottom = (hz: number) =>
		((LAYOUT.levelRows + LAYOUT.gap + (hz / MAX_HZ) * LAYOUT.rows) / total) * 100;
	const ticks = [1000, 2000, 3000, 4000];
</script>

<div class="pointer-events-none absolute inset-0" aria-hidden="true">
	{#each ticks as hz (hz)}
		<div class="absolute inset-x-0 border-t border-foreground/10" style="bottom: {bottom(hz)}%">
			<span
				class="absolute top-0 left-1 -translate-y-1/2 rounded-sm bg-card/70 px-0.5 text-[10px] leading-none text-muted-foreground tabular-nums"
			>
				{hz / 1000} kHz
			</span>
		</div>
	{/each}
</div>
