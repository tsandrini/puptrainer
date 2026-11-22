<script lang="ts">
	// The takes as a table: every take a row, searched, filtered, sorted and
	// paged; its numbers against the everyday voice as columns; a play button
	// that sends it to the dock with the table (as filtered and sorted) as
	// the list to walk through. Ticked rows can be played, compared (two),
	// analysed again or saved as CSV. The view lives in the address, so
	// coming back from a take finds it as it was. The list refreshes while a
	// take is being analysed and when an upload goes through.
	import type { ColumnDef } from '@tanstack/table-core';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import GitCompareIcon from '@lucide/svelte/icons/git-compare-arrows';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { analyseTake, fetchAllTakes, requeueAnalysis } from '#lib/api/index.js';
	import type { Intent, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import AnalysisBadge from '#lib/components/app/AnalysisBadge.svelte';
	import DateRange from '#lib/components/app/DateRange.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import Help from '#lib/components/app/Help.svelte';
	import Highlight from '#lib/components/app/Highlight.svelte';
	import VoiceMark from '#lib/components/app/VoiceMark.svelte';
	import DataTable from '#lib/components/data-table/DataTable.svelte';
	import FacetFilter, { type Facet } from '#lib/components/data-table/FacetFilter.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { renderSnippet } from '#lib/components/ui/data-table/index.js';
	import { datedName, saveFile, toCsv } from '#lib/csv.js';
	import { fmtDateTime, fmtDuration, fmtMetric, fmtSigned } from '#lib/format.js';
	import { searchWords } from '#lib/highlight.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { Kept } from '#lib/kept.svelte.js';
	import { player } from '#lib/player.svelte.js';
	import { queue } from '#lib/queue.svelte.js';
	import { decodeRange, encodeRange, inRange } from '#lib/range.js';
	import { shiftOf } from '#lib/targets.js';
	import { saveTrail } from '#lib/trail.js';
	import { ViewState } from '#lib/view.svelte.js';

	const POLL_MS = 2_000;
	const INTENTS: Intent[] = ['attempt', 'habitual', 'drill'];
	/** A take's distances from the everyday voice, as columns. */
	const SHIFTS = [
		'pitch_shift_st',
		'brightness_pct',
		'r1_shift_pct',
		'lightness_shift_db',
		'level_shift_db',
		'clarity_shift_db'
	];
	/** Columns a first visit does not show: there, but out of the way. */
	const TUCKED = ['r1_shift_pct', 'level_shift_db', 'clarity_shift_db', 'device', 'note'];

	const view = new ViewState('takes', {
		q: '',
		voice: [] as string[],
		kind: [] as string[],
		lang: [] as string[],
		what: [] as string[],
		from: [] as string[],
		mic: [] as string[],
		range: 'all',
		sort: '-recorded',
		page: 1,
		size: 25
	});
	const v = view.value;
	const columnsKept = new Kept<string[]>('columns.takes', TUCKED);

	let takes = $state.raw<TakeOut[] | null>(null);
	let selected = $state<string[]>([]);
	/** The table as searched and sorted: what the dock walks through. */
	let shown = $state.raw<TakeOut[]>([]);
	let busy = $state(false);
	const now = Date.now();

	const words = $derived(searchWords(v.q));
	const range = $derived(decodeRange(v.range));
	const pitch = $derived(app.metric('pitch_median_hz'));
	const waiting = $derived(
		(takes ?? []).some((t) => t.analysis?.status === 'pending' || t.analysis?.status === 'claimed')
	);
	const earliest = $derived(
		takes?.length ? Math.min(...takes.map((t) => Date.parse(t.recorded_at))) : null
	);
	/** Takes whose numbers come from another pipeline version than the worker runs now. */
	const outdated = $derived.by(() => {
		const current = app.health?.pipeline_version;
		if (!current) return 0;
		return (takes ?? []).filter(
			(t) => t.analysis?.status === 'done' && t.analysis.pipeline_version !== current
		).length;
	});

	const kindKey = (take: TakeOut) => take.item;
	const kindLabel = (take: TakeOut) =>
		i18n.t.item[take.item] + (take.language ? `, ${i18n.language(take.language)}` : '');
	/** What was read or done: the exercise, else the text. */
	const whatKey = (take: TakeOut) => take.exercise_ref?.split('@')[0] ?? take.content_ref ?? '';
	function whatLabel(take: TakeOut): string {
		const exercise = app.exerciseOf(take.exercise_ref);
		if (exercise) return i18n.pick(exercise.titles);
		if (take.exercise_ref) return i18n.t.takes.gone;
		return app.passage(take.content_ref)?.title ?? '';
	}
	const fromKey = (take: TakeOut) => (take.exercise_ref || take.session_id ? 'practice' : 'lab');

	/** The choices of a filter: every value the takes have, with how many takes. */
	function facets(key: (take: TakeOut) => string, label: (take: TakeOut) => string): Facet[] {
		const found: Record<string, Facet & { count: number }> = {};
		for (const take of takes ?? []) {
			const value = key(take);
			if (!value) continue;
			found[value] ??= { value, label: label(take), count: 0 };
			found[value].count++;
		}
		return Object.values(found).sort((a, b) => b.count - a.count);
	}
	const voices = $derived(
		facets(
			(t) => t.intent,
			(t) => i18n.t.intent[t.intent]
		).sort((a, b) => INTENTS.indexOf(a.value as Intent) - INTENTS.indexOf(b.value as Intent))
	);
	const kinds = $derived(facets(kindKey, (t) => i18n.t.item[t.item]));
	const languages = $derived(
		facets(
			(t) => t.language ?? '',
			(t) => i18n.language(t.language)
		)
	);
	const whats = $derived(facets(whatKey, whatLabel));
	const origins = $derived(facets(fromKey, (t) => i18n.t.takes.from[fromKey(t)]));
	const mics = $derived(
		facets(
			(t) => `${t.device_id}`,
			(t) => t.device_name
		)
	);

	const pass = (chosen: string[], value: string) => !chosen.length || chosen.includes(value);
	const rows = $derived(
		(takes ?? []).filter(
			(t) =>
				pass(v.voice, t.intent) &&
				pass(v.kind, kindKey(t)) &&
				pass(v.lang, t.language ?? '') &&
				pass(v.what, whatKey(t)) &&
				pass(v.from, fromKey(t)) &&
				pass(v.mic, `${t.device_id}`) &&
				inRange(range, Date.parse(t.recorded_at), now)
		)
	);

	/** What search looks through: everything a row says, and its note and file name. */
	const searchText = (take: TakeOut) =>
		[
			fmtDateTime(take.recorded_at, i18n.locale),
			kindLabel(take),
			i18n.t.intent[take.intent],
			whatLabel(take),
			take.device_name,
			take.note,
			take.original_name
		].join(' · ');

	/** The pitch column: the median, or for a glide its lowest to its highest note. */
	function headline(take: TakeOut): string {
		const { glide_low_hz: low, glide_high_hz: high } = take.metrics;
		if (take.item === 'glide' && low !== undefined && high !== undefined)
			return `${Math.round(low)}–${Math.round(high)} Hz`;
		if (pitch && take.metrics.pitch_median_hz !== undefined)
			return fmtMetric(take.metrics.pitch_median_hz, pitch, i18n.locale);
		return i18n.t.common.none;
	}
	const measure = (key: string) => app.measures.find((m) => m.key === key);
	const number = { headClass: 'text-end', cellClass: 'text-end tabular-nums' };

	const columns = $derived<ColumnDef<TakeOut>[]>([
		{
			id: 'play',
			enableSorting: false,
			enableHiding: false,
			header: '',
			cell: ({ row }) => renderSnippet(playCell, { take: row.original }),
			meta: { headClass: 'w-9', cellClass: 'w-9' }
		},
		{
			id: 'recorded',
			accessorFn: (t) => t.recorded_at,
			sortDescFirst: true,
			enableHiding: false,
			header: i18n.t.takes.recorded,
			cell: ({ row }) => renderSnippet(recordedCell, { take: row.original }),
			meta: { label: i18n.t.takes.recorded }
		},
		{
			id: 'voice',
			accessorFn: (t) => INTENTS.indexOf(t.intent),
			header: i18n.t.intent.label,
			cell: ({ row }) => renderSnippet(voiceCell, { take: row.original }),
			meta: { label: i18n.t.intent.label }
		},
		{
			id: 'kind',
			accessorFn: kindLabel,
			header: i18n.t.takes.what,
			cell: ({ row }) => renderSnippet(textCell, { text: kindLabel(row.original) }),
			meta: { label: i18n.t.takes.what }
		},
		{
			id: 'what',
			accessorFn: whatLabel,
			header: i18n.t.takes.text,
			cell: ({ row }) => renderSnippet(textCell, { text: whatLabel(row.original), soft: true }),
			meta: { label: i18n.t.takes.text, cellClass: 'max-w-56 truncate' }
		},
		{
			id: 'duration',
			accessorFn: (t) => t.duration_s,
			header: i18n.t.takes.duration,
			cell: ({ row }) => fmtDuration(row.original.duration_s),
			meta: { label: i18n.t.takes.duration, ...number }
		},
		{
			id: 'pitch',
			accessorFn: (t) => t.metrics.pitch_median_hz,
			sortUndefined: 'last',
			header: i18n.t.takes.pitch,
			cell: ({ row }) => headline(row.original),
			meta: {
				label: i18n.t.takes.pitch,
				title: pitch ? i18n.pick(pitch.titles) : undefined,
				...number
			}
		},
		...SHIFTS.map((key): ColumnDef<TakeOut> => ({
			id: key,
			accessorFn: (t) => shiftOf(t.reading, key)?.value,
			sortUndefined: 'last',
			sortDescFirst: true,
			header: i18n.t.takes.shifts[key] ?? key,
			cell: ({ row }) => renderSnippet(shiftCell, { take: row.original, key }),
			meta: {
				label: `${i18n.pick(measure(key)?.titles) || key} (${i18n.t.takes.against})`,
				title: `${i18n.pick(measure(key)?.titles) || key}, ${i18n.t.takes.against}`,
				...number
			}
		})),
		{
			id: 'comfort',
			accessorFn: (t) => t.comfort ?? undefined,
			sortUndefined: 'last',
			header: i18n.t.takes.comfort,
			cell: ({ row }) => renderSnippet(comfortCell, { take: row.original }),
			meta: { label: i18n.t.takes.comfort }
		},
		{
			id: 'result',
			accessorFn: (t) =>
				t.evaluation?.met === true ? 2 : t.evaluation?.met === false ? 1 : undefined,
			sortUndefined: 'last',
			sortDescFirst: true,
			header: i18n.t.takes.result,
			cell: ({ row }) => renderSnippet(resultCell, { take: row.original }),
			meta: { label: i18n.t.takes.result }
		},
		{
			id: 'device',
			accessorFn: (t) => t.device_name,
			header: i18n.t.takes.device,
			cell: ({ row }) => renderSnippet(textCell, { text: row.original.device_name }),
			meta: { label: i18n.t.takes.device }
		},
		{
			id: 'note',
			accessorFn: (t) => t.note,
			header: i18n.t.take.note,
			cell: ({ row }) => renderSnippet(textCell, { text: row.original.note, soft: true }),
			meta: { label: i18n.t.take.note, cellClass: 'max-w-72 truncate' }
		},
		{
			id: 'status',
			accessorFn: (t) => t.analysis?.status ?? '',
			header: i18n.t.takes.status,
			cell: ({ row }) => renderSnippet(statusCell, { take: row.original }),
			meta: { label: i18n.t.takes.status }
		}
	]);

	async function load(): Promise<void> {
		try {
			takes = await fetchAllTakes();
		} catch {
			// NOTE: the shell says when the API is away; the list keeps what it has
		}
	}

	async function reanalyse(): Promise<void> {
		await requeueAnalysis(app.health?.pipeline_version);
		await load();
	}

	/** Queue the ticked takes for analysis again. */
	async function analyse(list: TakeOut[]): Promise<void> {
		busy = true;
		try {
			await Promise.allSettled(list.map((take) => analyseTake(take.id)));
			await load();
		} finally {
			busy = false;
		}
	}

	/** Takes as a CSV file: what the row says and every number against the everyday voice. */
	function exportCsv(list: TakeOut[]): void {
		const header = [
			i18n.t.takes.recorded,
			i18n.t.intent.label,
			i18n.t.takes.what,
			i18n.t.common.language,
			i18n.t.takes.text,
			`${i18n.t.takes.duration} (s)`,
			`${i18n.t.takes.pitch} (Hz)`,
			...SHIFTS.map(
				(key) => `${i18n.pick(measure(key)?.titles) || key} (${measure(key)?.unit ?? ''})`
			),
			i18n.t.takes.comfort,
			i18n.t.takes.result,
			i18n.t.takes.device,
			i18n.t.take.note,
			'id'
		];
		const lines = list.map((take) => [
			take.recorded_at,
			i18n.t.intent[take.intent],
			i18n.t.item[take.item],
			take.language,
			whatLabel(take),
			Math.round(take.duration_s * 10) / 10,
			take.metrics.pitch_median_hz,
			...SHIFTS.map((key) => shiftOf(take.reading, key)?.value),
			take.comfort,
			take.evaluation?.met,
			take.device_name,
			take.note,
			take.id
		]);
		saveFile(datedName('takes', 'csv'), toCsv([header, ...lines]));
	}

	// the table as it stands is the list a take's page steps through
	$effect(() => saveTrail(shown.map((take) => take.id)));

	$effect(() => {
		if (!waiting) return;
		const timer = setInterval(load, POLL_MS);
		return () => clearInterval(timer);
	});

	onMount(() => {
		void load();
		return queue.onUploaded(() => void load());
	});
</script>

{#snippet playCell({ take }: { take: TakeOut })}
	<Button
		size="icon-sm"
		variant={player.holds(take.id) ? 'default' : 'ghost'}
		class="rounded-full"
		aria-label={player.sounds(take.id) ? i18n.t.player.pause : i18n.t.takes.listen}
		title={i18n.t.takes.listen}
		onclick={() => player.toggle(take, shown)}
		data-testid="row-play"
		data-playing={player.sounds(take.id)}
	>
		{#if player.sounds(take.id)}<PauseIcon class="fill-current" />{:else}<PlayIcon
				class="fill-current"
			/>{/if}
	</Button>
{/snippet}

{#snippet recordedCell({ take }: { take: TakeOut })}
	<a class="font-bold underline-offset-4 hover:underline" href="/takes/{take.id}">
		<Highlight text={fmtDateTime(take.recorded_at, i18n.locale)} {words} />
	</a>
{/snippet}

{#snippet voiceCell({ take }: { take: TakeOut })}
	<span class="inline-flex items-center gap-1.5">
		<VoiceMark intent={take.intent} />
		<Highlight text={i18n.t.intent[take.intent]} {words} />
	</span>
{/snippet}

{#snippet textCell({ text, soft = false }: { text: string; soft?: boolean })}
	{#if text}
		<span class={soft ? 'text-muted-foreground' : ''} title={soft ? text : undefined}>
			<Highlight {text} {words} />
		</span>
	{:else}
		<span class="text-muted-foreground/60">—</span>
	{/if}
{/snippet}

{#snippet shiftCell({ take, key }: { take: TakeOut; key: string })}
	{@const shift = shiftOf(take.reading, key)}
	{@const def = measure(key)}
	{#if shift}
		{fmtSigned(shift.value, def?.decimals ?? 1, i18n.locale)}<span
			class="ps-1 text-xs text-muted-foreground">{def?.unit}</span
		>
	{:else if key === 'r1_shift_pct' && take.reading?.notes.includes('r1-unreadable')}
		<span class="text-muted-foreground" title={i18n.t.takes.unreadableHint}>
			{i18n.t.takes.unreadable}
		</span>
	{:else}
		<span class="text-muted-foreground/60">—</span>
	{/if}
{/snippet}

{#snippet comfortCell({ take }: { take: TakeOut })}
	{#if take.comfort !== null}
		<span class="tabular-nums">{take.comfort}</span>
		<span class="text-muted-foreground">{i18n.t.practice.run.comforts[take.comfort - 1]}</span>
	{:else}
		<span class="text-muted-foreground/60">—</span>
	{/if}
{/snippet}

{#snippet resultCell({ take }: { take: TakeOut })}
	{#if take.evaluation?.met === true}
		<Badge class="bg-good/15 text-good" data-met="true">{i18n.t.takes.met}</Badge>
	{:else if take.evaluation?.met === false}
		<Badge variant="outline" data-met="false">{i18n.t.takes.notYet}</Badge>
	{:else}
		<span class="text-muted-foreground/60">—</span>
	{/if}
{/snippet}

{#snippet statusCell({ take }: { take: TakeOut })}
	<AnalysisBadge analysis={take.analysis} />
{/snippet}

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h1 class="text-2xl">{i18n.t.takes.title}</h1>
	<Help title={i18n.t.takes.title} text={i18n.t.takes.help} wide>
		<ul class="space-y-1 text-sm text-muted-foreground">
			{#each INTENTS as intent (intent)}
				<li class="flex items-center gap-2">
					<VoiceMark {intent} class="text-foreground" />
					<span>{i18n.t.intent[intent]}</span>
				</li>
			{/each}
		</ul>
	</Help>
	{#if takes}
		<span class="text-sm text-muted-foreground tabular-nums" data-testid="takes-count">
			{takes.length}
		</span>
	{/if}
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

{#if takes?.length === 0}
	<Empty text={i18n.t.takes.empty}>
		<Button href="/record">{i18n.t.nav.record}</Button>
		<Button href="/import" variant="outline">{i18n.t.nav.import}</Button>
	</Empty>
{:else}
	<div data-testid="takes">
		<DataTable
			{columns}
			{rows}
			rowId={(take) => take.id}
			text={searchText}
			bind:search={v.q}
			bind:sort={v.sort}
			bind:page={v.page}
			bind:size={v.size}
			bind:hidden={() => columnsKept.value, (next) => columnsKept.set(next)}
			bind:selected
			bind:shown
			loading={takes === null}
			selectable
			label={i18n.t.takes.title}
			emptyText={i18n.t.takes.emptyFiltered}
			rowClass={(take) => player.holds(take.id) && 'bg-primary/8 hover:bg-primary/12'}
		>
			{#snippet filters()}
				<FacetFilter
					label={i18n.t.intent.label}
					options={voices}
					bind:value={v.voice}
					onchange={() => (v.page = 1)}
					testid="filter-voice"
				/>
				<FacetFilter
					label={i18n.t.takes.what}
					options={kinds}
					bind:value={v.kind}
					onchange={() => (v.page = 1)}
					testid="filter-kind"
				/>
				{#if languages.length > 1}
					<FacetFilter
						label={i18n.t.common.language}
						options={languages}
						bind:value={v.lang}
						onchange={() => (v.page = 1)}
						testid="filter-language"
					/>
				{/if}
				{#if whats.length > 1}
					<FacetFilter
						label={i18n.t.takes.text}
						options={whats}
						bind:value={v.what}
						onchange={() => (v.page = 1)}
						testid="filter-what"
					/>
				{/if}
				{#if origins.length > 1}
					<FacetFilter
						label={i18n.t.takes.origin}
						options={origins}
						bind:value={v.from}
						onchange={() => (v.page = 1)}
						testid="filter-from"
					/>
				{/if}
				{#if mics.length > 1}
					<FacetFilter
						label={i18n.t.takes.device}
						options={mics}
						bind:value={v.mic}
						onchange={() => (v.page = 1)}
						testid="filter-mic"
					/>
				{/if}
				<DateRange
					bind:value={
						() => range,
						(next) => {
							v.range = encodeRange(next);
							v.page = 1;
						}
					}
					{earliest}
				/>
				{#if view.changed}
					<Button
						variant="ghost"
						size="sm"
						class="h-8"
						onclick={() => view.reset()}
						data-testid="view-reset"
					>
						<RotateIcon />
						{i18n.t.table.reset}
					</Button>
				{/if}
			{/snippet}
			{#snippet actions()}
				<Button
					variant="outline"
					size="sm"
					class="h-8"
					disabled={!shown.length}
					title={i18n.t.takes.exportHint}
					onclick={() => exportCsv(shown)}
					data-testid="takes-export"
				>
					<DownloadIcon />
					<span class="hidden sm:inline">CSV</span>
				</Button>
			{/snippet}
			{#snippet bulk(ticked: TakeOut[])}
				<Button size="sm" onclick={() => player.play(ticked[0], ticked)} data-testid="bulk-play">
					<PlayIcon class="fill-current" />
					{i18n.t.takes.listen}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={ticked.length !== 2}
					title={ticked.length === 2 ? undefined : i18n.t.takes.compareHint}
					onclick={() => goto(`/compare?a=${ticked[0].id}&b=${ticked[1].id}`)}
					data-testid="compare"
				>
					<GitCompareIcon />
					{i18n.t.takes.compare}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => analyse(ticked)}
					data-testid="bulk-analyse"
				>
					<RefreshIcon class={busy ? 'animate-spin' : ''} />
					{i18n.t.takes.reanalyse}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => exportCsv(ticked)}
					data-testid="bulk-export"
				>
					<DownloadIcon />
					CSV
				</Button>
			{/snippet}
		</DataTable>
	</div>
{/if}
