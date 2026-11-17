<script lang="ts">
	// What an exercise asks for, why, when to stop, and where it comes from.
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import type { Exercise } from '#lib/api/types.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let { exercise, why = true }: { exercise: Exercise; why?: boolean } = $props();
</script>

<div class="space-y-2 text-sm">
	<p data-testid="instructions">{i18n.pick(exercise.instructions)}</p>
	{#if i18n.pick(exercise.safety)}
		<p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5">
			<span class="font-semibold">{i18n.t.practice.safety}:</span>
			{i18n.pick(exercise.safety)}
		</p>
	{/if}
	{#if why}
		<p class="text-muted-foreground">
			<span class="font-semibold text-foreground">{i18n.t.practice.why}:</span>
			{i18n.pick(exercise.why)}
		</p>
	{/if}
	<div class="text-xs text-muted-foreground">
		<span class="font-semibold">{i18n.t.practice.sources}:</span>
		{#each exercise.sources as source, index (source.url + index)}
			<a
				class="mr-2 inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
				href={source.url}
				target="_blank"
				rel="noreferrer"
			>
				{source.author}, {source.title}<ExternalLinkIcon class="size-3" />
			</a>
		{/each}
	</div>
</div>
