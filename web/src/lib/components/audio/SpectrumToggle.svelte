<script lang="ts">
	// Switches every spectrogram on the page between harmonics and formants,
	// and says behind its help button what each of the two shows.
	import type { View } from '#lib/audio/spectrum.js';
	import Help from '#lib/components/app/Help.svelte';
	import { spectrumView } from '#lib/audio/view.svelte.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	const views: View[] = ['harmonics', 'formants'];
</script>

<div class="inline-flex items-center gap-1">
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
	<Help title={i18n.t.player.view} align="end">
		<dl class="space-y-1.5 text-sm text-muted-foreground" data-testid="spectrum-help">
			{#each views as view (view)}
				<div>
					<dt class="inline font-semibold text-foreground">{i18n.t.player.views[view]}:</dt>
					<dd class="inline">{i18n.t.player.viewHint[view]}</dd>
				</div>
			{/each}
		</dl>
	</Help>
</div>
