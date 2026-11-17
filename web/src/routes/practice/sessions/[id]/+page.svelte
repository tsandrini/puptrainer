<script lang="ts">
	// One practice session from the log: how it started and ended, and its
	// takes in order, each with its exercise, comfort and result.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.js';
	import { deletePractice, fetchPractice, fetchTakes } from '#lib/api/index.js';
	import type { PracticeOut, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import EvaluationView from '#lib/components/app/EvaluationView.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDateTime } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	const id = $derived(page.params.id!);
	let session = $state.raw<PracticeOut | null>(null);
	let takes = $state.raw<TakeOut[]>([]);
	let missing = $state(false);
	let error = $state<string | null>(null);

	const comfort = (value: number | null | undefined) =>
		value ? `${value} · ${i18n.t.practice.run.comforts[value - 1]}` : i18n.t.common.none;

	$effect(() => {
		const current = id;
		void (async () => {
			try {
				session = await fetchPractice(current);
				takes = (await fetchTakes({ session_id: current })).sort((a, b) =>
					a.recorded_at.localeCompare(b.recorded_at)
				);
				missing = false;
			} catch (e) {
				if (e instanceof ApiError && e.status === 404) missing = true;
				else error = e instanceof Error ? e.message : String(e);
			}
		})();
	});

	async function remove() {
		if (!confirm(i18n.t.practice.session.confirmDelete)) return;
		try {
			await deletePractice(id);
			await goto('/practice');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

{#if missing}
	<p class="text-muted-foreground">{i18n.t.practice.session.notFound}</p>
{:else if !session}
	<p class="text-muted-foreground">{error ?? i18n.t.common.loading}</p>
{:else}
	<h1 class="mb-1 text-2xl">
		{i18n.pick(app.routineOf(session.routine_ref)?.titles) || i18n.t.practice.single}
	</h1>
	<p class="mb-4 text-sm text-muted-foreground">
		{fmtDateTime(session.started_at, i18n.locale)} · {i18n.t.practice.takes(session.take_count)}
		{#if !session.ended_at}· {i18n.t.practice.unfinished}{/if}
	</p>

	<dl class="panel mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="session">
		<div class="flex justify-between gap-2">
			<dt class="text-muted-foreground">{i18n.t.practice.session.feel}</dt>
			<dd>
				{session.feel_start ? i18n.t.practice.run.feel[session.feel_start] : i18n.t.common.none}
			</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-muted-foreground">{i18n.t.practice.session.comfort}</dt>
			<dd data-testid="comfort-end">{comfort(session.comfort_end)}</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-muted-foreground">{i18n.t.practice.session.tension}</dt>
			<dd>
				{session.lasting_tension === null
					? i18n.t.common.none
					: session.lasting_tension
						? i18n.t.practice.run.yes
						: i18n.t.practice.run.no}
			</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-muted-foreground">{i18n.t.common.language}</dt>
			<dd>{i18n.language(session.language)}</dd>
		</div>
		{#if session.note}
			<div class="sm:col-span-2">
				<dt class="text-muted-foreground">{i18n.t.practice.run.note}</dt>
				<dd class="whitespace-pre-line">{session.note}</dd>
			</div>
		{/if}
	</dl>

	<ol class="space-y-3" data-testid="session-takes">
		{#each takes as take (take.id)}
			<li class="panel">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<a class="font-semibold hover:text-primary" href="/takes/{take.id}">
						{i18n.pick(app.exerciseOf(take.exercise_ref)?.titles) || i18n.t.item[take.item]}
					</a>
					<span class="text-xs text-muted-foreground">
						{fmtDateTime(take.recorded_at, i18n.locale)} · {i18n.t.take.comfort}:
						{comfort(take.comfort)}
					</span>
				</div>
				{#if take.evaluation}
					<EvaluationView evaluation={take.evaluation} />
				{/if}
			</li>
		{/each}
	</ol>

	{#if error}
		<p class="mt-3 text-sm text-critical" role="alert">{error}</p>
	{/if}
	<div class="mt-4 flex gap-2">
		<Button variant="outline" href="/practice">{i18n.t.practice.run.back}</Button>
		<Button variant="ghost" onclick={remove}>{i18n.t.common.delete}</Button>
	</div>
{/if}
