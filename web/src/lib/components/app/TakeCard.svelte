<script lang="ts">
	// One take in a few lines, for the point of a chart the pointer rests on
	// or a click pinned: when it was recorded, what it is, how it felt, its
	// note, the numbers the chart is about, a button to hear it and a way to
	// its page.
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import PlayIcon from '@lucide/svelte/icons/play';
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDateTime, fmtDuration } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let {
		take,
		facts = [],
		playing = false,
		pinned = false,
		problem = null,
		ontoggle,
		onunpin
	}: {
		take: TakeOut | null;
		/** The numbers to say about it: a name and a value each. */
		facts?: { label: string; value: string }[];
		/** It is the take that sounds right now. */
		playing?: boolean;
		/** A click holds the card to this take, whatever the pointer does. */
		pinned?: boolean;
		/** Why it did not sound: the browser wants a click on the page first, or it failed. */
		problem?: 'blocked' | 'failed' | null;
		ontoggle?: () => void;
		onunpin?: () => void;
	} = $props();

	const exercise = $derived(app.exerciseOf(take?.exercise_ref));
	const passage = $derived(app.passage(take?.content_ref));
</script>

<div
	class={[
		'flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm',
		pinned && 'border-primary'
	]}
	data-testid="take-card"
	data-take={take?.id ?? ''}
	data-pinned={pinned}
>
	{#if take}
		<Button
			size="icon"
			variant="outline"
			class="rounded-full"
			aria-label={playing ? i18n.t.player.pause : i18n.t.player.play}
			onclick={ontoggle}
			data-testid="take-card-toggle"
			data-playing={playing}
		>
			{#if playing}<PauseIcon class="size-4 fill-current" />{:else}<PlayIcon
					class="size-4 fill-current"
				/>{/if}
		</Button>
		<div class="min-w-0">
			<a class="font-semibold underline-offset-2 hover:underline" href="/takes/{take.id}">
				{fmtDateTime(take.recorded_at, i18n.locale)}
			</a>
			<span class="text-muted-foreground">
				· {exercise ? i18n.pick(exercise.titles) : i18n.t.item[take.item]}{#if take.language}, {i18n.language(
						take.language
					)}{/if}
				· {i18n.t.intent[take.intent]} · {fmtDuration(take.duration_s)}
				{#if passage}· {passage.title}{/if}
				{#if take.comfort !== null}· {i18n.t.card.comfort(take.comfort)}{/if}
			</span>
			{#if take.note}<p class="truncate text-xs text-muted-foreground">{take.note}</p>{/if}
		</div>
		<dl class="ml-auto flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums">
			{#each facts as fact (fact.label)}
				<div class="flex gap-1.5">
					<dt class="text-muted-foreground">{fact.label}</dt>
					<dd class="font-semibold">{fact.value}</dd>
				</div>
			{/each}
		</dl>
		<div class="flex gap-2">
			{#if pinned}
				<Button
					size="sm"
					variant="secondary"
					title={i18n.t.card.unpinHint}
					onclick={onunpin}
					data-testid="take-card-unpin"
				>
					<PinOffIcon class="size-4" />
					{i18n.t.card.unpin}
				</Button>
			{/if}
			<Button size="sm" variant="outline" href="/takes/{take.id}" data-testid="take-card-open">
				{i18n.t.card.open}
			</Button>
		</div>
		{#if problem}
			<p
				class={[
					'basis-full text-xs',
					problem === 'failed' ? 'text-critical' : 'text-muted-foreground'
				]}
				role={problem === 'failed' ? 'alert' : undefined}
				data-testid="take-card-problem"
				data-problem={problem}
			>
				{i18n.t.card.problems[problem]}
			</p>
		{/if}
	{:else}
		<p class="text-muted-foreground">{i18n.t.card.none}</p>
	{/if}
</div>
