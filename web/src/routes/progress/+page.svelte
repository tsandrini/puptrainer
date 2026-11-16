<script lang="ts">
	// Progress: each measurement over time, one point per take, for one
	// kind of take on one microphone setup at a time (numbers are only
	// comparable like with like). Everyday voice and attempts are separate
	// lines.
	import { fetchTakes } from '#lib/api/index.js';
	import type { Intent, Item, MetricDef, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import Empty from '#lib/components/app/Empty.svelte';
	import Figure from '#lib/components/charts/Figure.svelte';
	import Trend, { type TrendSeries } from '#lib/components/charts/Trend.svelte';
	import { INTENT_COLOR } from '#lib/charts.js';
	import { fmtDateTime, fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	type Kind = { key: string; item: Item; language: string | null; label: string };
	const INTENTS: Intent[] = ['habitual', 'attempt'];
	/** Recording-quality numbers say nothing about the voice; they stay on the take's page. */
	const SKIP = new Set(['recording']);

	let takes = $state.raw<TakeOut[] | null>(null);
	let deviceId = $state<number | null>(null);
	let kindKey = $state('');

	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);
	/** The kinds of take that exist on this setup, most takes first. */
	const kinds = $derived.by(() => {
		const found: Record<string, Kind & { count: number }> = {};
		for (const take of takes ?? []) {
			if (take.device_id !== device?.id) continue;
			const key = `${take.item}:${take.language ?? ''}`;
			found[key] ??= {
				key,
				item: take.item,
				language: take.language,
				label: i18n.t.item[take.item] + (take.language ? `, ${i18n.language(take.language)}` : ''),
				count: 0
			};
			found[key].count++;
		}
		return Object.values(found).sort((a, b) => b.count - a.count);
	});
	const kind = $derived(kinds.find((k) => k.key === kindKey) ?? kinds[0] ?? null);
	const shown = $derived(
		(takes ?? [])
			.filter(
				(t) =>
					kind !== null &&
					t.device_id === device?.id &&
					t.item === kind.item &&
					t.language === kind.language &&
					Object.keys(t.metrics).length > 0
			)
			.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
	);
	const metrics = $derived(
		kind
			? app
					.groups(kind.item)
					.filter((g) => !SKIP.has(g.group))
					.flatMap((g) => g.metrics)
					.filter((m) => shown.some((t) => t.metrics[m.key] !== undefined))
			: []
	);

	function seriesFor(metric: MetricDef): TrendSeries[] {
		return INTENTS.map((intent) => ({
			key: intent,
			label: i18n.t.intent[intent],
			color: INTENT_COLOR[intent],
			points: shown
				.filter((t) => t.intent === intent && t.metrics[metric.key] !== undefined)
				.map((t) => ({
					ts: Date.parse(t.recorded_at),
					value: t.metrics[metric.key],
					label: fmtDateTime(t.recorded_at, i18n.locale)
				}))
		})).filter((s) => s.points.length);
	}

	const shortDate = (ts: number) =>
		new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
			day: 'numeric',
			month: 'short'
		}).format(new Date(ts));

	$effect(() => {
		void fetchTakes()
			.then((all) => (takes = all))
			.catch(() => {
				// NOTE: the shell says when the API is away
			});
	});
</script>

<div class="mb-1 flex flex-wrap items-center gap-2">
	<h1 class="mr-auto text-2xl">{i18n.t.progress.title}</h1>
	{#if app.devices.length > 1}
		<select
			class="select"
			aria-label={i18n.t.takes.device}
			value={device?.id}
			onchange={(event) => (deviceId = Number(event.currentTarget.value))}
		>
			{#each app.devices as option (option.id)}
				<option value={option.id}>{option.name}</option>
			{/each}
		</select>
	{/if}
	{#if kinds.length}
		<select
			class="select"
			aria-label={i18n.t.progress.kind}
			value={kind?.key}
			onchange={(event) => (kindKey = event.currentTarget.value)}
			data-testid="kind"
		>
			{#each kinds as option (option.key)}
				<option value={option.key}>{option.label} ({option.count})</option>
			{/each}
		</select>
	{/if}
</div>
<p class="mb-4 text-sm text-muted-foreground">{i18n.t.progress.intro}</p>

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if !metrics.length}
	<Empty text={i18n.t.progress.empty} />
{:else}
	<div class="grid gap-4 md:grid-cols-2" data-testid="trends">
		{#each metrics as metric (metric.key)}
			{@const series = seriesFor(metric)}
			{@const latest = series[0]?.points.at(-1)}
			<Figure
				title={i18n.pick(metric.titles) || metric.key}
				sub={i18n.pick(metric.descriptions)}
				value={latest ? fmtMetric(latest.value, metric, i18n.locale) : undefined}
				legend={series.map((s) => ({ label: s.label, color: s.color }))}
				table={{
					headers: [i18n.t.progress.taken, i18n.t.intent.label, i18n.pick(metric.titles)],
					rows: series.flatMap((s) =>
						s.points.map((p) => [p.label, s.label, fmtMetric(p.value, metric, i18n.locale)])
					)
				}}
			>
				<Trend {series} fmt={(v) => fmtMetric(v, metric, i18n.locale)} fmtTime={shortDate} />
			</Figure>
		{/each}
	</div>
{/if}
