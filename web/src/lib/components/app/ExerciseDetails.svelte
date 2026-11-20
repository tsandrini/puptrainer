<script lang="ts">
	// An exercise, spelled out: what it is for, the order of one take as a
	// small picture, what to do step by step, what it is like when it goes
	// right, the common mistakes, when to stop, and where it comes from.
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import type { Exercise } from '#lib/api/types.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import SequenceStrip from './SequenceStrip.svelte';

	let {
		exercise,
		brief = false
	}: {
		exercise: Exercise;
		/** Only the steps, for a glance while recording. */
		brief?: boolean;
	} = $props();

	const steps = $derived(exercise.steps[i18n.locale] ?? exercise.steps.en ?? []);
	const mistakes = $derived(exercise.mistakes[i18n.locale] ?? exercise.mistakes.en ?? []);
</script>

<div class="space-y-3 text-sm" data-testid="exercise-details">
	{#if !brief}
		<p class="text-muted-foreground">
			<span class="font-semibold text-foreground">{i18n.t.practice.why}:</span>
			{i18n.pick(exercise.why)}
		</p>
	{/if}
	{#if exercise.sequence.length}
		<SequenceStrip parts={exercise.sequence} />
	{/if}
	<ol class="list-decimal space-y-1 pl-5" data-testid="steps">
		{#each steps as step, index (index)}
			<li>{step}</li>
		{/each}
	</ol>
	{#if !brief}
		<p class="rounded-md border border-good/40 bg-good/10 px-3 py-1.5">
			<span class="font-semibold">{i18n.t.practice.right}:</span>
			{i18n.pick(exercise.right)}
		</p>
		{#if mistakes.length}
			<div>
				<p class="font-semibold">{i18n.t.practice.mistakes}</p>
				<ul class="list-disc space-y-1 pl-5 text-muted-foreground">
					{#each mistakes as mistake, index (index)}
						<li>{mistake}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if i18n.pick(exercise.safety)}
			<p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5">
				<span class="font-semibold">{i18n.t.practice.safety}:</span>
				{i18n.pick(exercise.safety)}
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
	{/if}
</div>
