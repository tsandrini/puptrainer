<script lang="ts">
	// One take: the player with the take moment by moment under it, for a
	// practice take its exercise, comfort and result, its reading against the
	// learner's everyday voice (pitch and resonance), every measurement in
	// groups with what it means, the vowels (or held sounds) one by one, the
	// labels (editable), the state of the analysis with a retry, and delete.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.js';
	import {
		analyseTake,
		deleteTake,
		fetchTake,
		fetchTrace,
		takeAudioUrl,
		updateTake
	} from '#lib/api/index.js';
	import type { Intent, Item, TakeOut, Trace, VowelSegment } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import TakeReview from '#lib/components/audio/TakeReview.svelte';
	import AnalysisBadge from '#lib/components/app/AnalysisBadge.svelte';
	import EvaluationView from '#lib/components/app/EvaluationView.svelte';
	import LabelFields from '#lib/components/app/LabelFields.svelte';
	import MetricGroups from '#lib/components/app/MetricGroups.svelte';
	import PersonMark from '#lib/components/app/PersonMark.svelte';
	import PersonSelect from '#lib/components/app/PersonSelect.svelte';
	import ReadingView from '#lib/components/app/ReadingView.svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { fmtDateTime, fmtDuration, fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { passageFor, passageRef } from '#lib/labels.js';
	import { shapeOf } from '#lib/people.js';
	import { trailAround } from '#lib/trail.js';

	const POLL_MS = 2_000;

	const id = $derived(page.params.id!);
	/** Where this take sits in the list it was opened from (the takes table as it stood). */
	const trail = $derived(trailAround(id));
	let take = $state.raw<TakeOut | null>(null);
	let trace = $state.raw<Trace | null>(null);
	let missing = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);

	let item = $state<Item>('other');
	let language = $state<string | null>(null);
	let intent = $state<Intent>('habitual');
	let personId = $state<number | null>(null);
	let note = $state('');

	const waiting = $derived(
		take?.analysis?.status === 'pending' || take?.analysis?.status === 'claimed'
	);
	const dirty = $derived(
		take !== null &&
			(item !== take.item ||
				language !== take.language ||
				intent !== take.intent ||
				personId !== take.person_id ||
				note !== take.note)
	);
	/** Whose voice it is, when it is not the default person's: then the page says so. */
	const other = $derived(
		take !== null && take.person_id !== app.me?.id ? app.person(take.person_id) : null
	);
	const passage = $derived(app.passage(take?.content_ref));
	const exercise = $derived(app.exerciseOf(take?.exercise_ref));
	/** The names of the exercise's sounds, for the held sounds of its take. */
	const sounds = $derived(
		(exercise?.sequence ?? []).filter((part) => !part.pause).map((part) => i18n.pick(part.labels))
	);
	const spoken = $derived(
		take !== null && ['phrase', 'passage', 'free', 'other'].includes(take.item)
	);
	const hz = (value: number) => `${Math.round(value)} Hz`;
	/** An analysed voice with nothing to be read against: say what is missing. */
	const unread = $derived(
		take !== null &&
			take.reading === null &&
			take.intent === 'attempt' &&
			!['glide', 'sustain'].includes(take.item) &&
			Object.keys(take.metrics).length > 0
	);
	/** The vowels of a vowels take, or the held sounds of a sustain take. */
	const segments = $derived<{ title: string; rows: VowelSegment[]; testid: string } | null>(
		take?.details.vowels.length
			? { title: i18n.t.take.vowels, rows: take.details.vowels, testid: 'vowels' }
			: take?.details.segments.length
				? { title: i18n.t.take.segments, rows: take.details.segments, testid: 'segments' }
				: null
	);

	function show(next: TakeOut, labels: boolean) {
		take = next;
		if (!labels) return;
		item = next.item;
		language = next.language;
		intent = next.intent;
		personId = next.person_id;
		note = next.note;
	}

	async function load(labels: boolean) {
		try {
			const next = await fetchTake(id);
			show(next, labels);
			missing = false;
			trace = next.series.length ? await fetchTrace(id).catch(() => null) : null;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) missing = true;
		}
	}

	$effect(() => {
		void id;
		take = null;
		trace = null;
		void load(true);
	});

	$effect(() => {
		if (!waiting) return;
		const timer = setInterval(() => load(false), POLL_MS);
		return () => clearInterval(timer);
	});

	async function act(work: () => Promise<void>) {
		error = null;
		saved = false;
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const save = () =>
		act(async () => {
			// NOTE: the text that was read follows the item and the language
			const text = item === 'passage' ? passageFor(app.content?.passages ?? [], language) : null;
			const content_ref =
				item === take?.item && language === take?.language
					? take?.content_ref
					: text
						? passageRef(text)
						: null;
			const moved = personId !== null && personId !== take?.person_id;
			show(
				await updateTake(id, {
					item,
					language,
					intent,
					note,
					content_ref,
					...(moved ? { person_id: personId } : {})
				}),
				true
			);
			// NOTE: the people's take counts moved with it
			if (moved) void app.refreshPeople();
			saved = true;
		});

	const analyse = () => act(async () => show(await analyseTake(id), false));

	const setComfort = (value: string) =>
		act(async () => show(await updateTake(id, { comfort: value ? Number(value) : null }), false));

	const remove = () =>
		act(async () => {
			if (!confirm(i18n.t.take.confirmDelete)) return;
			await deleteTake(id);
			await goto('/');
		});
</script>

<svelte:window
	onkeydown={(event) => {
		// NOTE: [ and ] step through the list the take was opened from
		if (!trail || event.ctrlKey || event.metaKey || event.altKey) return;
		if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
			return;
		const to = event.key === '[' ? trail.previous : event.key === ']' ? trail.next : null;
		if (to) void goto(`/takes/${to}`);
	}}
/>

{#if missing}
	<p class="text-muted-foreground">{i18n.t.take.notFound}</p>
{:else if take === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<h1 class="text-2xl">
			{i18n.t.item[take.item]}{#if take.language}, {i18n.language(take.language)}{/if}
		</h1>
		<AnalysisBadge analysis={take.analysis} />
		{#if trail && trail.length > 1}
			<div class="flex items-center gap-1" data-testid="trail">
				<Button
					variant="outline"
					size="icon-sm"
					href={trail.previous ? `/takes/${trail.previous}` : undefined}
					disabled={!trail.previous}
					aria-label={i18n.t.take.previous}
					title={i18n.t.take.previous}
					data-testid="trail-previous"
				>
					<ChevronLeftIcon />
				</Button>
				<span class="text-xs text-muted-foreground tabular-nums" data-testid="trail-place">
					{trail.place} / {trail.length}
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					href={trail.next ? `/takes/${trail.next}` : undefined}
					disabled={!trail.next}
					aria-label={i18n.t.take.next}
					title={i18n.t.take.next}
					data-testid="trail-next"
				>
					<ChevronRightIcon />
				</Button>
			</div>
		{/if}
		{#if other}
			<span
				class="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/8 px-2.5 py-0.5 text-sm font-bold"
				data-testid="take-person"
			>
				<PersonMark shape={shapeOf(app.people, other.id)} class="text-primary" />
				{other.name}
			</span>
		{/if}
		<span class="ml-auto text-sm text-muted-foreground">
			{fmtDateTime(take.recorded_at, i18n.locale)} · {i18n.t.intent[take.intent]} · {take.device_name}
			· {fmtDuration(take.duration_s)}
		</span>
	</div>

	<!-- NOTE: wide, the take and what it is read as sit beside its numbers; narrow, above them -->
	<div class="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
		<div class="min-w-0 space-y-4" data-testid="take-main">
			<div class="panel space-y-2">
				<TakeReview
					source={takeAudioUrl(take.id)}
					name="{take.id}.flac"
					{trace}
					band={take.target ? [take.target.band_low_hz, take.target.band_high_hz] : [145, 185]}
					labels={sounds}
				/>
				{#if trace && trace.rows.length && spoken}
					<p class="text-xs text-muted-foreground" data-testid="traces-speech">
						{i18n.t.traces.speech}
					</p>
				{/if}
			</div>

			{#if take.exercise_ref}
				<section class="panel space-y-2" data-testid="practice">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<h2 class="text-base">
							{i18n.t.take.exercise}:
							{i18n.pick(exercise?.titles) || take.exercise_ref}
						</h2>
						{#if take.session_id}
							<a class="text-sm hover:text-primary" href="/practice/sessions/{take.session_id}">
								{i18n.t.take.session}
							</a>
						{/if}
					</div>
					<label class="flex items-center gap-2 text-sm">
						<span class="text-muted-foreground">{i18n.t.take.comfort}</span>
						<select
							class="select"
							value={take.comfort ?? ''}
							onchange={(event) => setComfort(event.currentTarget.value)}
							data-testid="take-comfort"
						>
							<option value="">{i18n.t.common.none}</option>
							{#each i18n.t.practice.run.comforts as label, index (index)}
								<option value={index + 1}>{index + 1} · {label}</option>
							{/each}
						</select>
					</label>
					{#if take.evaluation}
						<EvaluationView evaluation={take.evaluation} />
					{/if}
				</section>
			{/if}

			{#if error}
				<p
					class="rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
					role="alert"
				>
					{error}
				</p>
			{/if}
			{#if take.analysis?.status === 'failed'}
				<p
					class="rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
					data-testid="analysis-error"
				>
					{take.analysis.error}
				</p>
			{/if}

			{#if take.reading}
				<ReadingView
					reading={take.reading}
					metrics={take.metrics}
					text={take.content_ref !== null}
					advice={other === null}
				/>
			{:else if unread}
				<p class="panel text-sm text-muted-foreground" data-testid="unread">
					{i18n.t.reading.none}
				</p>
			{/if}

			{#if segments}
				<section class="panel" data-testid={segments.testid}>
					<h2 class="mb-2 text-base">{segments.title}</h2>
					<div class="overflow-x-auto">
						<table class="w-full text-sm tabular-nums">
							<thead class="text-left text-xs text-muted-foreground">
								<tr>
									<th class="py-1 pr-3 font-medium">{i18n.t.take.vowel}</th>
									<th class="py-1 pr-3 font-medium">{i18n.t.take.heldFor}</th>
									<th class="py-1 pr-3 font-medium">{i18n.t.take.pitch}</th>
									<th class="py-1 pr-3 font-medium">F1</th>
									<th class="py-1 pr-3 font-medium">F2</th>
									<th class="py-1 pr-3 font-medium">F3</th>
									<th class="py-1 pr-3 font-medium">F4</th>
									<th class="py-1 pr-3 font-medium">CPPS</th>
									<th class="py-1 font-medium">HNR</th>
								</tr>
							</thead>
							<tbody>
								{#each segments.rows as vowel (vowel.start_s)}
									<tr class="border-t">
										<td class="py-1.5 pr-3 text-base font-extrabold">
											{vowel.vowel ?? i18n.t.common.none}
										</td>
										<td class="py-1.5 pr-3">{fmtNumber(vowel.duration_s, 1, i18n.locale)} s</td>
										<td class="py-1.5 pr-3">{hz(vowel.pitch_hz)}</td>
										{#each [0, 1, 2, 3] as index (index)}
											<td class="py-1.5 pr-3">
												{index in vowel.formants_hz
													? hz(vowel.formants_hz[index])
													: i18n.t.common.none}
											</td>
										{/each}
										<td class="py-1.5 pr-3">{fmtNumber(vowel.cpps_db, 1, i18n.locale)} dB</td>
										<td class="py-1.5">{fmtNumber(vowel.hnr_db, 1, i18n.locale)} dB</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/if}
		</div>
		<div class="min-w-0 space-y-4" data-testid="take-side">
			{#if Object.keys(take.metrics).length === 0}
				<p class="panel text-sm text-muted-foreground">{i18n.t.take.noMetrics}</p>
			{:else}
				<MetricGroups {take} />
			{/if}

			<div class="flex items-center gap-3">
				{#if !waiting}
					<Button variant="outline" size="sm" onclick={analyse}>
						{take.analysis?.status === 'failed' ? i18n.t.common.retry : i18n.t.analysis.again}
					</Button>
				{/if}
				{#if take.analysis?.pipeline_version}
					<span class="text-xs text-muted-foreground">
						{i18n.t.take.pipeline(take.analysis.pipeline_version)}
					</span>
				{/if}
			</div>

			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
				<section class="panel">
					<h2 class="mb-2 text-base">{i18n.t.take.labels}</h2>
					<LabelFields bind:item bind:language bind:intent />
					{#if app.people.length > 1}
						<label class="mt-3 flex flex-wrap items-center gap-2 text-sm">
							<span class="text-muted-foreground">{i18n.t.people.whose}</span>
							<PersonSelect bind:value={personId} testid="take-whose" />
						</label>
					{/if}
					<label class="mt-3 block text-sm">
						<span class="mb-1 block text-muted-foreground">{i18n.t.take.note}</span>
						<Textarea bind:value={note} rows={3} />
					</label>
					<div class="mt-3 flex items-center gap-3">
						<Button size="sm" disabled={!dirty} onclick={save}>{i18n.t.common.save}</Button>
						{#if saved && !dirty}
							<span class="text-sm text-muted-foreground">{i18n.t.take.saved}</span>
						{/if}
						<Button variant="destructive" size="sm" class="ml-auto" onclick={remove}>
							{i18n.t.common.delete}
						</Button>
					</div>
				</section>

				<section class="panel">
					{#if passage}
						<h2 class="mb-2 text-base">{i18n.t.take.passage}</h2>
						<p class="mb-4 text-sm leading-relaxed text-muted-foreground" lang={passage.language}>
							{passage.text}
						</p>
					{/if}
					<h2 class="mb-2 text-base">{i18n.t.take.file}</h2>
					<p class="text-sm text-muted-foreground">
						{i18n.t.take.format(take.sample_rate, take.channels)}
						{#if take.original_name}
							<span>· {i18n.t.take.original}:</span>
							<span class="font-mono text-xs">{take.original_name}</span>
						{/if}
					</p>
				</section>
			</div>
		</div>
	</div>
{/if}
