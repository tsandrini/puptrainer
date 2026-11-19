<script lang="ts">
	// Switches every spectrogram on the page between harmonics and formants.
	import type { View } from '#lib/audio/spectrum.js';
	import { spectrumView } from '#lib/audio/view.svelte.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	const views: View[] = ['harmonics', 'formants'];
</script>

<div
	class="inline-flex rounded-full border bg-card p-0.5 text-xs font-semibold"
	role="group"
	aria-label={i18n.t.player.view}
	data-testid="spectrum-toggle"
>
	{#each views as view (view)}
		<button
			type="button"
			class={cn(
				'rounded-full px-2.5 py-1 transition-colors',
				spectrumView.value === view
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground'
			)}
			aria-pressed={spectrumView.value === view}
			title={i18n.t.player.viewHint[view]}
			data-view={view}
			onclick={() => spectrumView.set(view)}
		>
			{i18n.t.player.views[view]}
		</button>
	{/each}
</div>
