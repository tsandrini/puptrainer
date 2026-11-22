<script lang="ts">
	// Practice: the band to work in, the guided sessions (routines), the
	// exercise catalogue by skill with its sources, and the practice log.
	import { onMount } from 'svelte';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { fetchPracticeList } from '#lib/api/index.js';
	import type { PracticeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import BandCard from '#lib/components/app/BandCard.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import ExerciseDetails from '#lib/components/app/ExerciseDetails.svelte';
	import Help from '#lib/components/app/Help.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDateTime } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let log = $state.raw<PracticeOut[] | null>(null);

	const content = $derived(app.content);
	/** Where each exercise first comes in the routines: the order they teach them in. */
	const taught = $derived.by(() => {
		const order: Record<string, number> = {};
		for (const routine of content?.routines ?? [])
			for (const step of routine.steps) order[step.exercise] ??= Object.keys(order).length;
		return order;
	});
	const skills = $derived(
		(content?.skills ?? [])
			.map((skill) => ({
				skill,
				exercises: (content?.exercises ?? [])
					.filter((e) => e.skill === skill.key)
					.sort((a, b) => (taught[a.id] ?? 1e9) - (taught[b.id] ?? 1e9))
			}))
			.filter((s) => s.exercises.length)
	);

	onMount(async () => {
		try {
			log = await fetchPracticeList();
		} catch {
			log = [];
		}
	});
</script>

<h1 class="mb-3 flex items-center gap-2 text-2xl">
	{i18n.t.practice.title}
	<Help title={i18n.t.practice.title} text={i18n.t.practice.intro} />
</h1>

{#if !app.loaded}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else}
	<div class="grid items-start gap-4 lg:grid-cols-2">
		<BandCard />

		<section class="panel" data-testid="routines">
			<h2 class="mb-2 text-base">{i18n.t.practice.sessions}</h2>
			<ul class="space-y-3">
				{#each content?.routines ?? [] as routine (routine.id)}
					<li class="rounded-xl border bg-card p-3" data-routine={routine.id}>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<h3 class="font-bold">{i18n.pick(routine.titles)}</h3>
							<span class="text-xs text-muted-foreground">
								{i18n.t.practice.minutes(routine.minutes)}
							</span>
						</div>
						<p class="text-sm text-muted-foreground">{i18n.pick(routine.summaries)}</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{routine.steps.map((s) => i18n.pick(app.exercise(s.exercise)?.titles)).join(' · ')}
						</p>
						{#if app.band}
							<Button
								class="mt-2 rounded-full"
								href="/practice/run?routine={routine.id}"
								data-testid="start-{routine.id}"
							>
								<PlayIcon class="size-4" />
								{i18n.t.practice.start}
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if !app.band}
				<p class="mt-2 text-sm text-muted-foreground">{i18n.t.practice.needBand}</p>
			{/if}
		</section>
	</div>

	<h2 class="mt-6 mb-2 text-xl">{i18n.t.practice.catalogue}</h2>
	<div class="space-y-4" data-testid="catalogue">
		{#each skills as { skill, exercises } (skill.key)}
			<section class="panel" data-skill={skill.key}>
				<h3 class="flex items-center gap-1 text-base">
					{i18n.pick(skill.titles)}
					<Help
						title={i18n.pick(skill.titles)}
						text={[
							i18n.pick(skill.descriptions),
							skill.aliases.length ? `${i18n.t.practice.aliases}: ${skill.aliases.join(', ')}` : ''
						]}
						wide
					/>
				</h3>
				<div class="mt-2 divide-y">
					{#each exercises as exercise (exercise.id)}
						<details class="py-2" data-exercise={exercise.id}>
							<summary class="cursor-pointer">
								<span class="font-semibold">{i18n.pick(exercise.titles)}</span>
								<span class="text-sm text-muted-foreground">
									— {i18n.pick(exercise.summaries)}</span
								>
							</summary>
							<div class="mt-2 pl-4">
								<ExerciseDetails {exercise} />
								{#if app.band}
									<Button
										class="mt-2"
										size="sm"
										variant="outline"
										href="/practice/run?exercise={exercise.id}"
									>
										<PlayIcon class="size-4" />
										{i18n.t.practice.alone}
									</Button>
								{/if}
							</div>
						</details>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	<h2 class="mt-6 mb-2 text-xl">{i18n.t.practice.log}</h2>
	{#if log === null}
		<p class="text-muted-foreground">{i18n.t.common.loading}</p>
	{:else if log.length === 0}
		<Empty text={i18n.t.practice.logEmpty} />
	{:else}
		<ul class="panel divide-y" data-testid="practice-log">
			{#each log as session (session.id)}
				<li>
					<a
						class="flex flex-wrap items-baseline gap-x-3 py-2 hover:text-primary"
						href="/practice/sessions/{session.id}"
					>
						<span class="font-semibold">
							{i18n.pick(app.routineOf(session.routine_ref)?.titles) ||
								(session.routine_ref ? i18n.t.practice.earlier : i18n.t.practice.single)}
						</span>
						<span class="text-sm text-muted-foreground">
							{fmtDateTime(session.started_at, i18n.locale)}
						</span>
						<span class="text-sm">{i18n.t.practice.takes(session.take_count)}</span>
						{#if session.comfort_end}
							<span class="text-sm text-muted-foreground">
								{i18n.t.take.comfort}: {i18n.t.practice.run.comforts[session.comfort_end - 1]}
							</span>
						{/if}
						{#if !session.ended_at}
							<span class="text-xs text-muted-foreground">{i18n.t.practice.unfinished}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
