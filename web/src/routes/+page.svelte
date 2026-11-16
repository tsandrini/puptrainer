<script lang="ts">
	// The takes: newest first, filtered by what, which voice and language;
	// the list refreshes while a take is still being analysed and when an
	// upload goes through.
	import { onMount } from 'svelte';
	import { fetchTakes } from '#lib/api/index.js';
	import type { Intent, Item, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import AnalysisBadge from '#lib/components/app/AnalysisBadge.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { fmtDateTime, fmtDuration, fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { queue } from '#lib/queue.svelte.js';

	const POLL_MS = 2_000;
	const items: Item[] = ['vowels', 'glide', 'passage', 'free', 'other'];
	const intents: Intent[] = ['habitual', 'attempt'];

	let takes = $state.raw<TakeOut[] | null>(null);
	let item = $state('');
	let intent = $state('');
	let language = $state('');

	const filtered = $derived(Boolean(item || intent || language));
	const waiting = $derived(
		(takes ?? []).some((t) => t.analysis?.status === 'pending' || t.analysis?.status === 'claimed')
	);
	const pitch = $derived(app.metrics.find((m) => m.key === 'pitch_median_hz'));

	async function load() {
		try {
			takes = await fetchTakes({ item, intent, language });
		} catch {
			// NOTE: the shell says when the API is away; the list keeps what it has
		}
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
	<h1 class="mr-auto text-xl font-semibold">{i18n.t.takes.title}</h1>
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

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if takes.length === 0}
	<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		<p>{filtered ? i18n.t.takes.emptyFiltered : i18n.t.takes.empty}</p>
		{#if !filtered}
			<div class="mt-4 flex justify-center gap-2">
				<Button href="/record">{i18n.t.nav.record}</Button>
				<Button href="/import" variant="outline">{i18n.t.nav.import}</Button>
			</div>
		{/if}
	</div>
{:else}
	<Table.Root data-testid="takes">
		<Table.Header>
			<Table.Row>
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
						<a class="font-medium underline-offset-4 hover:underline" href="/takes/{take.id}">
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
					<Table.Cell class="text-right tabular-nums">
						{pitch && take.metrics.pitch_median_hz !== undefined
							? fmtMetric(take.metrics.pitch_median_hz, pitch, i18n.locale)
							: i18n.t.common.none}
					</Table.Cell>
					<Table.Cell><AnalysisBadge analysis={take.analysis} /></Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
