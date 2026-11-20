<script lang="ts">
	// Progress: one point per take, for one kind of take on one microphone
	// setup at a time (numbers are only comparable like with like), in a
	// section per target: pitch, resonance, and what they cost. Each section
	// leads with the take's distance from the learner's own everyday voice,
	// then the measurements behind it. Everyday voice and attempts are
	// separate lines. Drills are sounds, not a voice, and never draw a line;
	// attempts made inside practice sessions join only when asked for.
	import { fetchTakes } from '#lib/api/index.js';
	import type { Item, MeasureDef, MetricDef, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import Empty from '#lib/components/app/Empty.svelte';
	import Figure from '#lib/components/charts/Figure.svelte';
	import Trend, { type TrendSeries } from '#lib/components/charts/Trend.svelte';
	import { INTENT_COLOR, type Voice } from '#lib/charts.js';
	import { fmtDateTime, fmtMetric, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { ROLE, SHIFTS, TARGETS, shiftOf } from '#lib/targets.js';

	type Kind = { key: string; item: Item; language: string | null; label: string };
	const INTENTS: Voice[] = ['habitual', 'attempt'];
	/** A distance is about the attempt: its line comes first and carries the label. */
	const SHIFT_INTENTS: Voice[] = ['attempt', 'habitual'];
	/** Recording-quality numbers say nothing about the voice; they stay on the take's page. */
	const SKIP = new Set(['recording']);

	let takes = $state.raw<TakeOut[] | null>(null);
	let deviceId = $state<number | null>(null);
	let kindKey = $state('');
	let withPractice = $state(false);

	/** The takes that speak for a voice: lab takes, and practice attempts when asked for. */
	const voiced = $derived(
		(takes ?? []).filter((t) => t.intent !== 'drill' && (withPractice || !t.exercise_ref))
	);

	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);
	/** The kinds of take that exist on this setup, most takes first. */
	const kinds = $derived.by(() => {
		const found: Record<string, Kind & { count: number }> = {};
		for (const take of voiced) {
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
		voiced
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

	/** A take's distance from the everyday voice over time, by voice. */
	function shiftSeries(key: string): TrendSeries[] {
		return SHIFT_INTENTS.map((intent) => ({
			key: intent,
			label: i18n.t.intent[intent],
			color: INTENT_COLOR[intent],
			points: shown.flatMap((t) => {
				const shift = t.intent === intent ? shiftOf(t.reading, key) : null;
				return shift
					? [
							{
								ts: Date.parse(t.recorded_at),
								value: shift.value,
								label: fmtDateTime(t.recorded_at, i18n.locale)
							}
						]
					: [];
			})
		})).filter((s) => s.points.length);
	}

	const fmtShift = (value: number, measure: MeasureDef) =>
		`${fmtSigned(value, measure.decimals, i18n.locale)}${measure.unit ? ` ${measure.unit}` : ''}`;

	/**
	 * What a distance's scale shows whatever the points are: zero, and the near quarter of
	 * the zone it is read by, so the way still to go is on the picture.
	 */
	function reach(measure: MeasureDef): number[] {
		const zone = measure.zones.find((z) => z.key === 'typical');
		if (!zone || zone.low === null || zone.high === null) return [0];
		return [0, zone.low + (zone.high - zone.low) / 4];
	}

	/** What there is to chart, target by target. */
	const sections = $derived(
		TARGETS.map((target) => ({
			target,
			shifts: SHIFTS[target].flatMap((key) => {
				const measure = app.measures.find((m) => m.key === key);
				const series = measure ? shiftSeries(key) : [];
				return measure && series.length ? [{ measure, series }] : [];
			}),
			metrics: metrics.filter((m) => ROLE[m.group] === target)
		})).filter((s) => s.shifts.length || s.metrics.length)
	);

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
<p class="mb-2 text-sm text-muted-foreground">{i18n.t.progress.intro}</p>
<label class="mb-4 flex items-center gap-2 text-sm">
	<input type="checkbox" bind:checked={withPractice} data-testid="with-practice" />
	{i18n.t.progress.withPractice}
</label>

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if !metrics.length}
	<Empty text={i18n.t.progress.empty} />
{:else}
	<div class="space-y-6" data-testid="trends">
		{#each sections as section (section.target)}
			<section data-target={section.target}>
				<h2 class="text-xl">{i18n.t.targets[section.target]}</h2>
				<p class="mb-2 max-w-3xl text-sm text-muted-foreground">
					{i18n.t.targets.intro[section.target]}
				</p>
				<div class="grid gap-4 md:grid-cols-2">
					{#each section.shifts as { measure, series } (measure.key)}
						{@const latest = series[0]?.points.at(-1)}
						{@const title = `${i18n.pick(measure.titles)} ${i18n.t.progress.against}`}
						<Figure
							{title}
							sub={i18n.pick(measure.descriptions)}
							value={latest ? fmtShift(latest.value, measure) : undefined}
							legend={[
								...series.map((s) => ({ label: s.label, color: s.color })),
								...measure.zones.map((z) => ({
									label: i18n.pick(z.titles),
									color: z.key === 'typical' ? 'var(--good)' : 'var(--warning)'
								}))
							]}
							table={{
								headers: [i18n.t.progress.taken, i18n.t.intent.label, i18n.pick(measure.titles)],
								rows: series.flatMap((s) =>
									s.points.map((p) => [p.label, s.label, fmtShift(p.value, measure)])
								)
							}}
							class="border-primary/40"
						>
							<div data-shift-trend={measure.key}>
								<Trend
									{series}
									zones={measure.zones}
									include={reach(measure)}
									fmt={(v) => fmtShift(v, measure)}
									fmtTime={shortDate}
								/>
							</div>
						</Figure>
					{/each}
					{#each section.metrics as metric (metric.key)}
						{@const series = seriesFor(metric)}
						{@const latest = series[0]?.points.at(-1)}
						<Figure
							title={i18n.pick(metric.titles) || metric.key}
							sub={`${i18n.pick(metric.descriptions)} ${i18n.pick(metric.relates)}`}
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
			</section>
		{/each}
	</div>
{/if}
