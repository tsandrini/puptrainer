<script lang="ts">
	// The parts of one take in order, as a row of labels with arrows between
	// them: what comes first, where the pauses are, how long each part
	// lasts. Shown with an exercise's instructions and while recording, so
	// the order does not have to be remembered.
	import type { SequencePart } from '#lib/api/types.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	let { parts }: { parts: SequencePart[] } = $props();
</script>

<ol
	class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
	aria-label={i18n.t.practice.order}
	data-testid="sequence"
>
	{#each parts as part, index (index)}
		{#if index}<li class="text-muted-foreground" aria-hidden="true">→</li>{/if}
		<li
			class={cn(
				'rounded-full border px-2.5 py-0.5',
				part.pause
					? 'border-dashed text-xs text-muted-foreground'
					: 'border-primary/40 bg-card font-semibold'
			)}
			data-pause={part.pause}
		>
			{part.pause ? i18n.t.practice.pause : i18n.pick(part.labels)}
			{#if part.seconds}
				<span class="font-normal text-muted-foreground tabular-nums">· {part.seconds} s</span>
			{/if}
		</li>
	{/each}
</ol>
