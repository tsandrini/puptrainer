<script lang="ts">
	// One take: the player, its labels (editable), every measurement with
	// what it means, the state of the analysis with a retry, and delete.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.js';
	import { analyseTake, deleteTake, fetchTake, takeAudioUrl, updateTake } from '#lib/api/index.js';
	import type { Intent, Item, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import AnalysisBadge from '#lib/components/app/AnalysisBadge.svelte';
	import LabelFields from '#lib/components/app/LabelFields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { fmtDateTime, fmtDuration, fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { passageFor, passageRef } from '#lib/labels.js';

	const POLL_MS = 2_000;

	const id = $derived(page.params.id!);
	let take = $state.raw<TakeOut | null>(null);
	let missing = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);

	let item = $state<Item>('other');
	let language = $state<string | null>(null);
	let intent = $state<Intent>('habitual');
	let note = $state('');

	const waiting = $derived(
		take?.analysis?.status === 'pending' || take?.analysis?.status === 'claimed'
	);
	const dirty = $derived(
		take !== null &&
			(item !== take.item ||
				language !== take.language ||
				intent !== take.intent ||
				note !== take.note)
	);
	const passage = $derived(app.passage(take?.content_ref));

	function show(next: TakeOut, labels: boolean) {
		take = next;
		if (!labels) return;
		item = next.item;
		language = next.language;
		intent = next.intent;
		note = next.note;
	}

	async function load(labels: boolean) {
		try {
			show(await fetchTake(id), labels);
			missing = false;
		} catch (e) {
			if (e instanceof ApiError && e.status === 404) missing = true;
		}
	}

	$effect(() => {
		void id;
		take = null;
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
			show(await updateTake(id, { item, language, intent, note, content_ref }), true);
			saved = true;
		});

	const analyse = () => act(async () => show(await analyseTake(id), false));

	const remove = () =>
		act(async () => {
			if (!confirm(i18n.t.take.confirmDelete)) return;
			await deleteTake(id);
			await goto('/');
		});
</script>

{#if missing}
	<p class="text-muted-foreground">{i18n.t.take.notFound}</p>
{:else if take === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else}
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<h1 class="text-xl font-semibold">
			{i18n.t.item[take.item]}{#if take.language}, {i18n.language(take.language)}{/if}
		</h1>
		<AnalysisBadge analysis={take.analysis} />
		<span class="ml-auto text-sm text-muted-foreground">
			{fmtDateTime(take.recorded_at, i18n.locale)} · {take.device_name} · {fmtDuration(
				take.duration_s
			)}
		</span>
	</div>

	<audio class="mb-6 w-full" controls preload="metadata" src={takeAudioUrl(take.id)}></audio>

	{#if error}
		<p
			class="mb-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
			role="alert"
		>
			{error}
		</p>
	{/if}

	<div class="grid gap-8 md:grid-cols-2">
		<section>
			<h2 class="mb-2 font-medium">{i18n.t.take.metrics}</h2>
			{#if take.analysis?.status === 'failed'}
				<p class="mb-2 text-sm text-critical" data-testid="analysis-error">{take.analysis.error}</p>
			{/if}
			{#if Object.keys(take.metrics).length === 0}
				<p class="text-sm text-muted-foreground">{i18n.t.take.noMetrics}</p>
			{:else}
				<dl class="divide-y text-sm" data-testid="metrics">
					{#each app.metrics as metric (metric.key)}
						{#if take.metrics[metric.key] !== undefined}
							<div class="py-2">
								<div class="flex justify-between gap-4">
									<dt>{i18n.pick(metric.titles) || metric.key}</dt>
									<dd class="font-medium tabular-nums" data-metric={metric.key}>
										{fmtMetric(take.metrics[metric.key], metric, i18n.locale)}
									</dd>
								</div>
								<p class="mt-0.5 text-xs text-muted-foreground">{i18n.pick(metric.descriptions)}</p>
							</div>
						{/if}
					{/each}
				</dl>
			{/if}
			<div class="mt-3 flex items-center gap-3">
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
		</section>

		<section>
			<h2 class="mb-2 font-medium">{i18n.t.take.labels}</h2>
			<LabelFields bind:item bind:language bind:intent />
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

			{#if passage}
				<h2 class="mt-6 mb-2 font-medium">{i18n.t.take.passage}</h2>
				<p class="text-sm leading-relaxed text-muted-foreground" lang={passage.language}>
					{passage.text}
				</p>
			{/if}

			<h2 class="mt-6 mb-2 font-medium">{i18n.t.take.file}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.take.format(take.sample_rate, take.channels)}
				{#if take.original_name}
					<span>· {i18n.t.take.original}:</span>
					<span class="font-mono text-xs">{take.original_name}</span>
				{/if}
			</p>
		</section>
	</div>
{/if}
