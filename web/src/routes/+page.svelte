<script lang="ts">
	// The takes: newest first, filtered by what, which voice and language;
	// the list refreshes while a take is still being analysed and when an
	// upload goes through. Two ticked takes can be compared; takes analysed
	// by an older pipeline can be queued again in one go.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchTakes, requeueAnalysis } from '#lib/api/index.js';
	import type { Intent, Item, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import AnalysisBadge from '#lib/components/app/AnalysisBadge.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { fmtDateTime, fmtDuration, fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { queue } from '#lib/queue.svelte.js';

	const POLL_MS = 2_000;
	const items: Item[] = ['vowels', 'glide', 'sustain', 'phrase', 'passage', 'free', 'other'];
	const intents: Intent[] = ['habitual', 'attempt', 'drill'];

	let takes = $state.raw<TakeOut[] | null>(null);
	let item = $state('');
	let intent = $state('');
	let language = $state('');
	let picked = $state<string[]>([]);

	const filtered = $derived(Boolean(item || intent || language));
	const waiting = $derived(
		(takes ?? []).some((t) => t.analysis?.status === 'pending' || t.analysis?.status === 'claimed')
	);
	const pitch = $derived(app.metric('pitch_median_hz'));
	/** Takes whose numbers come from another pipeline version than the worker runs now. */
	const outdated = $derived.by(() => {
		const current = app.health?.pipeline_version;
		if (!current) return 0;
		return (takes ?? []).filter(
			(t) => t.analysis?.status === 'done' && t.analysis.pipeline_version !== current
		).length;
	});

	async function load() {
		try {
			takes = await fetchTakes({ item, intent, language });
			picked = picked.filter((id) => takes?.some((t) => t.id === id));
		} catch {
			// NOTE: the shell says when the API is away; the list keeps what it has
		}
	}

	async function reanalyse() {
		await requeueAnalysis(app.health?.pipeline_version);
		await load();
	}

	function pick(id: string, on: boolean) {
		// NOTE: two at most; a third replaces the older of the two
		picked = on ? [...picked, id].slice(-2) : picked.filter((p) => p !== id);
	}

	/** The pitch column: the median, or for a glide its lowest to its highest note. */
	function headline(take: TakeOut): string {
		const { glide_low_hz: low, glide_high_hz: high } = take.metrics;
		if (take.item === 'glide' && low !== undefined && high !== undefined)
			return `${Math.round(low)}–${Math.round(high)} Hz`;
		if (pitch && take.metrics.pitch_median_hz !== undefined)
			return fmtMetric(take.metrics.pitch_median_hz, pitch, i18n.locale);
		return i18n.t.common.none;
	}

	$effect(() => {
		void [item, intent, language];
		void load();
	});

	$effect(() => {
		if (!waiting) return;
		const timer = setInterval(load, POLL_MS);
		return () => clearInterval(timer);
	});

	onMount(() => queue.onUploaded(() => void load()));
</script>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<h1 class="mr-auto text-2xl">{i18n.t.takes.title}</h1>
	<select class="select" bind:value={item} aria-label={i18n.t.takes.what}>
		<option value="">{i18n.t.takes.allItems}</option>
		{#each items as value (value)}
			<option {value}>{i18n.t.item[value]}</option>
		{/each}
	</select>
	<select class="select" bind:value={intent} aria-label={i18n.t.intent.label}>
		<option value="">{i18n.t.takes.allIntents}</option>
		{#each intents as value (value)}
			<option {value}>{i18n.t.intent[value]}</option>
		{/each}
	</select>
	<select class="select" bind:value={language} aria-label={i18n.t.common.language}>
		<option value="">{i18n.t.takes.allLanguages}</option>
		<option value="en">{i18n.language('en')}</option>
		<option value="cs">{i18n.language('cs')}</option>
	</select>
</div>

{#if outdated > 0 && !waiting}
	<div
		class="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
		data-testid="outdated"
	>
		<span class="mr-auto">{i18n.t.takes.outdated(outdated)}</span>
		<Button size="sm" onclick={reanalyse}>{i18n.t.takes.reanalyse}</Button>
	</div>
{/if}

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if takes.length === 0}
	<Empty text={filtered ? i18n.t.takes.emptyFiltered : i18n.t.takes.empty}>
		{#if !filtered}
			<Button href="/record">{i18n.t.nav.record}</Button>
			<Button href="/import" variant="outline">{i18n.t.nav.import}</Button>
		{/if}
	</Empty>
{:else}
	<div class="panel p-0">
		<Table.Root data-testid="takes">
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-8"><span class="sr-only">{i18n.t.takes.select}</span></Table.Head>
					<Table.Head>{i18n.t.takes.recorded}</Table.Head>
					<Table.Head>{i18n.t.takes.what}</Table.Head>
					<Table.Head>{i18n.t.intent.label}</Table.Head>
					<Table.Head>{i18n.t.takes.device}</Table.Head>
					<Table.Head class="text-right">{i18n.t.takes.duration}</Table.Head>
					<Table.Head class="text-right">{i18n.t.takes.pitch}</Table.Head>
					<Table.Head>{i18n.t.takes.status}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each takes as take (take.id)}
					<Table.Row>
						<Table.Cell>
							<input
								type="checkbox"
								class="size-4 accent-primary"
								aria-label={i18n.t.takes.select}
								checked={picked.includes(take.id)}
								onchange={(event) => pick(take.id, event.currentTarget.checked)}
							/>
						</Table.Cell>
						<Table.Cell>
							<a class="font-bold underline-offset-4 hover:underline" href="/takes/{take.id}">
								{fmtDateTime(take.recorded_at, i18n.locale)}
							</a>
						</Table.Cell>
						<Table.Cell>
							{i18n.t.item[take.item]}{#if take.language}<span class="text-muted-foreground"
									>, {i18n.language(take.language)}</span
								>{/if}
						</Table.Cell>
						<Table.Cell>{i18n.t.intent[take.intent]}</Table.Cell>
						<Table.Cell>{take.device_name}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{fmtDuration(take.duration_s)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{headline(take)}</Table.Cell>
						<Table.Cell><AnalysisBadge analysis={take.analysis} /></Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	<div class="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
		<Button
			variant="outline"
			size="sm"
			disabled={picked.length !== 2}
			onclick={() => goto(`/compare?a=${picked[0]}&b=${picked[1]}`)}
			data-testid="compare"
		>
			{i18n.t.takes.compare}
		</Button>
		{#if picked.length !== 2}<span>{i18n.t.takes.compareHint}</span>{/if}
	</div>
{/if}
