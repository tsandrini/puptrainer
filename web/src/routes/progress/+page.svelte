<script lang="ts">
	// Progress: every take as data, for one kind of take on one microphone
	// setup at a time (numbers are only comparable like with like), over a
	// stretch of time of the reader's choosing. Every kind together is a
	// choice too: then only the distances from the everyday voice show, each
	// counted from the everyday takes of the take's own kind. First each take's distance
	// from the learner's own everyday voice, in three grids by unit; then any
	// two measures against each other; then every measurement by itself; then
	// what each exercise was judged on. The take under the pointer is named
	// in a card and can be heard there (or by resting the pointer on its
	// point); a click on a point pins the take to the card, which opens it:
	// the way that also works by touch. Drills are sounds, not a voice, and
	// only appear among the exercises; attempts made inside practice
	// sessions join the voice's charts when asked for.
	import { onDestroy } from 'svelte';
	import { browser } from '$app/env';
	import { fetchAllTakes, takeAudioUrl } from '#lib/api/index.js';
	import type { Item, MeasureDef, MetricDef, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import DateRange from '#lib/components/app/DateRange.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import Empty from '#lib/components/app/Empty.svelte';
	import TakeCard from '#lib/components/app/TakeCard.svelte';
	import Figure from '#lib/components/charts/Figure.svelte';
	import Plot, { type PlotSeries } from '#lib/components/charts/Plot.svelte';
	import Scatter, { type ScatterPoint } from '#lib/components/charts/Scatter.svelte';
	import type { Voice } from '#lib/charts.js';
	import { fmtDateTime, fmtMetric, fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { inRange, type TimeRange } from '#lib/range.js';
	import { ROLE, TARGETS, shiftOf } from '#lib/targets.js';

	/** A kind of take to look at; without an `item` it is every kind together. */
	type Kind = { key: string; item: Item | null; language: string | null; label: string };
	type Choice = {
		key: string;
		label: string;
		of: (take: TakeOut) => number | null;
		text: (value: number) => string;
	};
	const INTENTS: Voice[] = ['attempt', 'habitual'];
	/** Recording-quality numbers say nothing about the voice; they stay on the take's page. */
	const SKIP = new Set(['recording']);
	const HEAR_KEY = 'puptrainer.progress.hear';
	/** How long the pointer rests on a point before its take is played, in ms. */
	const REST_MS = 350;
	/** The distances from the everyday voice, by the grid they share a unit in. */
	const GRIDS = [
		{ key: 'pitch', shifts: ['pitch_shift_st'] },
		{ key: 'resonance', shifts: ['brightness_pct', 'r1_shift_pct'] },
		{ key: 'source', shifts: ['lightness_shift_db', 'level_shift_db', 'clarity_shift_db'] }
	] as const;
	/**
	 * A hue says which measure, wherever measures share a grid; the voice is in
	 * the marks all over the page: attempts filled, everyday takes hollow. A
	 * chart of one measure takes the first hue.
	 */
	const ONE = 'var(--series-1)';
	const COLOR: Record<string, string> = {
		pitch_shift_st: 'var(--series-1)',
		brightness_pct: 'var(--series-2)',
		r1_shift_pct: 'var(--series-3)',
		lightness_shift_db: 'var(--series-4)',
		level_shift_db: 'var(--series-5)',
		clarity_shift_db: 'var(--series-6)'
	};

	let takes = $state.raw<TakeOut[] | null>(null);
	let deviceId = $state<number | null>(null);
	let kindKey = $state('');
	let withPractice = $state(false);
	let range = $state<TimeRange>({ kind: 'all' });
	let voices = $state<Record<Voice, boolean>>({ habitual: true, attempt: true });
	let hear = $state(browser ? localStorage.getItem(HEAR_KEY) !== 'off' : true);
	/** The stretch of time the charts are zoomed into, in Unix seconds; shared by all of them. */
	let zoom = $state<[number, number] | null>(null);
	let crossX = $state('shift:lightness_shift_db');
	let crossY = $state('shift:brightness_pct');

	/** The take the card names: the last one the pointer was on, */
	let current = $state<string | null>(null);
	/** or the one a click pinned, whatever the pointer does since. */
	let pinned = $state<string | null>(null);
	let audio = $state<HTMLAudioElement | null>(null);
	let playing = $state<string | null>(null);
	/** Why the last take did not sound: the browser wants a click first, or the recording failed. */
	let problem = $state<'blocked' | 'failed' | null>(null);
	let rest: ReturnType<typeof setTimeout> | undefined;
	const now = Date.now();

	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);
	/** Everything on this setup in the chosen stretch of time, oldest first. */
	const scope = $derived(
		(takes ?? [])
			.filter((t) => t.device_id === device?.id && inRange(range, Date.parse(t.recorded_at), now))
			.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
	);
	/** The takes that speak for a voice: lab takes, and practice attempts when asked for. */
	const voiced = $derived(
		scope.filter((t) => t.intent !== 'drill' && (withPractice || !t.exercise_ref))
	);
	/** The kinds of take that exist on this setup, most takes first. */
	const kinds = $derived.by(() => {
		const found: Record<string, Kind & { count: number }> = {};
		for (const take of voiced) {
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
		const list: (Kind & { count: number })[] = Object.values(found).sort(
			(a, b) => b.count - a.count
		);
		const read = voiced.filter((t) => t.reading?.shifts.length).length;
		if (list.length > 1 && read)
			list.push({
				key: 'all',
				item: null,
				language: null,
				label: i18n.t.progress.allKinds,
				count: read
			});
		return list;
	});
	const kind = $derived(kinds.find((k) => k.key === kindKey) ?? kinds[0] ?? null);
	const shown = $derived(
		voiced.filter(
			(t) =>
				kind !== null &&
				(kind.item === null
					? Boolean(t.reading?.shifts.length)
					: t.item === kind.item && t.language === kind.language) &&
				t.intent !== 'drill' &&
				voices[t.intent] &&
				Object.keys(t.metrics).length > 0
		)
	);
	const metrics = $derived(
		kind?.item
			? app
					.groups(kind.item)
					.filter((g) => !SKIP.has(g.group))
					.flatMap((g) => g.metrics)
					.filter((m) => shown.some((t) => t.metrics[m.key] !== undefined))
			: []
	);
	const earliest = $derived(
		takes?.length ? Math.min(...takes.map((t) => Date.parse(t.recorded_at))) : null
	);

	/** When each take of a list was recorded, in Unix seconds, strictly rising for the plot. */
	function moments(list: TakeOut[]): number[] {
		const out: number[] = [];
		for (const take of list) {
			const at = Date.parse(take.recorded_at) / 1000;
			out.push(out.length && at <= out[out.length - 1] ? out[out.length - 1] + 1 : at);
		}
		return out;
	}
	const x = $derived(moments(shown));

	const def = (key: string) => app.measures.find((m) => m.key === key);
	const title = (key: string) => i18n.pick(def(key)?.titles) || key;
	const amount = (value: number, measure: MeasureDef | undefined) =>
		`${fmtSigned(value, measure?.decimals ?? 1, i18n.locale)}${measure?.unit ? ` ${measure.unit}` : ''}`;
	const day = new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
		day: 'numeric',
		month: 'short'
	});
	const hour = new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
		hour: '2-digit',
		minute: '2-digit'
	});
	const second = new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	/**
	 * A tick of the time axis: the day where one starts or ticks are days
	 * apart, else the time of day, to the second where ticks are that close.
	 */
	function tickTime(seconds: number, step: number): string {
		const moment = new Date(seconds * 1000);
		const midnight = moment.getHours() === 0 && moment.getMinutes() === 0;
		if (step >= 86_400 || (midnight && step >= 60)) return day.format(moment);
		return (step < 60 ? second : hour).format(moment);
	}

	/** The lines of one grid: each distance, attempts filled and everyday takes hollow. */
	function lines(shifts: readonly string[]): PlotSeries[] {
		return shifts.flatMap((key) =>
			INTENTS.flatMap((intent) => {
				const values = shown.map((t) =>
					t.intent === intent ? (shiftOf(t.reading, key)?.value ?? null) : null
				);
				if (!values.some((v) => v !== null)) return [];
				return [
					{
						key: `${key}:${intent}`,
						label: `${title(key)} · ${i18n.t.intent[intent]}`,
						color: COLOR[key],
						values,
						points: true,
						hollow: intent === 'habitual',
						faint: intent === 'habitual',
						format: (value: number) => amount(value, def(key))
					}
				];
			})
		);
	}
	const grids = $derived(
		GRIDS.map((grid) => ({ ...grid, series: lines(grid.shifts) })).filter((g) => g.series.length)
	);
	const zone = $derived(def('brightness_pct')?.zones.find((z) => z.key === 'typical'));

	function seriesFor(metric: MetricDef): PlotSeries[] {
		return INTENTS.toReversed().flatMap((intent) => {
			const values = shown.map((t) =>
				t.intent === intent ? (t.metrics[metric.key] ?? null) : null
			);
			if (!values.some((v) => v !== null)) return [];
			return [
				{
					key: intent,
					label: i18n.t.intent[intent],
					color: ONE,
					values,
					points: true,
					hollow: intent === 'habitual',
					faint: intent === 'habitual',
					format: (value: number) => fmtMetric(value, metric, i18n.locale)
				}
			];
		});
	}
	const sections = $derived(
		TARGETS.map((target) => ({
			target,
			metrics: metrics.filter((m) => ROLE[m.group] === target)
		})).filter((s) => s.metrics.length)
	);

	// --- one measure against another
	const choices = $derived<Choice[]>([
		...GRIDS.flatMap((grid) => grid.shifts)
			.filter((key) => shown.some((t) => shiftOf(t.reading, key)))
			.map((key) => ({
				key: `shift:${key}`,
				label: `${title(key)} ${i18n.t.progress.against}`,
				of: (take: TakeOut) => shiftOf(take.reading, key)?.value ?? null,
				text: (value: number) => amount(value, def(key))
			})),
		...metrics.map((metric) => ({
			key: `metric:${metric.key}`,
			label: i18n.pick(metric.titles) || metric.key,
			of: (take: TakeOut) => take.metrics[metric.key] ?? null,
			text: (value: number) => fmtMetric(value, metric, i18n.locale)
		}))
	]);
	const across = $derived(choices.find((c) => c.key === crossX) ?? choices[0] ?? null);
	const upwards = $derived(
		choices.find((c) => c.key === crossY) ?? choices.find((c) => c !== across) ?? null
	);
	const cloud = $derived<ScatterPoint[]>(
		across && upwards
			? shown.flatMap((take) => {
					const [px, py] = [across.of(take), upwards.of(take)];
					if (px === null || py === null || take.intent === 'drill') return [];
					return [
						{
							id: take.id,
							x: px,
							y: py,
							color: ONE,
							hollow: take.intent === 'habitual'
						}
					];
				})
			: []
	);
	/** How closely the two measures follow a straight line across the takes (Pearson's r). */
	const together = $derived.by(() => {
		const n = cloud.length;
		if (n < 3) return null;
		const mx = cloud.reduce((sum, p) => sum + p.x, 0) / n;
		const my = cloud.reduce((sum, p) => sum + p.y, 0) / n;
		const sxy = cloud.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0);
		const sxx = cloud.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
		const syy = cloud.reduce((sum, p) => sum + (p.y - my) ** 2, 0);
		return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
	});

	// --- what each exercise was judged on
	const drills = $derived(
		(app.content?.exercises ?? []).flatMap((exercise) => {
			const reps = scope.filter(
				(t) => app.exerciseOf(t.exercise_ref)?.id === exercise.id && t.evaluation?.measures.length
			);
			if (!reps.length) return [];
			const keys = [...new Set(reps.flatMap((t) => t.evaluation!.measures.map((m) => m.key)))];
			return [
				{
					exercise,
					reps,
					x: moments(reps),
					measures: keys.map((key) => {
						const measure = app.measure(key);
						const signed = key.endsWith('_pct') || key.endsWith('_st') || key.endsWith('_cents');
						const text = (value: number, decimals = measure?.decimals ?? 1) =>
							`${(signed ? fmtSigned : fmtNumber)(value, decimals, i18n.locale)}${measure?.unit ? ` ${measure.unit}` : ''}`;
						return {
							key,
							title: measure ? i18n.pick(measure.titles) : key,
							text,
							least: 4 * 10 ** -(measure?.decimals ?? 1),
							series: [
								{
									key,
									label: measure ? i18n.pick(measure.titles) : key,
									color: ONE,
									values: reps.map(
										(t) => t.evaluation!.measures.find((m) => m.key === key)?.value ?? null
									),
									points: true,
									format: (value: number) => text(value)
								}
							] satisfies PlotSeries[]
						};
					})
				}
			];
		})
	);

	// --- the take under the pointer, or the pinned one: named, heard, opened
	const named = $derived((takes ?? []).find((t) => t.id === (pinned ?? current)) ?? null);
	const facts = $derived.by(() => {
		const take = named;
		if (!take) return [];
		const shifts = (take.reading?.shifts ?? []).map((shift) => ({
			label: title(shift.key),
			value: amount(shift.value, def(shift.key))
		}));
		const judged = (take.evaluation?.measures ?? []).map((m) => {
			const measure = app.measure(m.key);
			return {
				label: measure ? i18n.pick(measure.titles) : m.key,
				value: `${fmtNumber(m.value, measure?.decimals ?? 1, i18n.locale)}${measure?.unit ? ` ${measure.unit}` : ''}`
			};
		});
		return [...shifts, ...judged].slice(0, 6);
	});

	function play(id: string): void {
		if (!audio) return;
		if (audio.dataset.take !== id) {
			audio.src = takeAudioUrl(id);
			audio.dataset.take = id;
		}
		audio.currentTime = 0;
		audio
			.play()
			.then(() => (problem = null))
			.catch((error: unknown) => {
				const name = error instanceof DOMException ? error.name : '';
				// NOTE: a pause or the next take ends a play that was starting: not a failure
				if (name === 'AbortError') return;
				// NOTE: browsers play sound only after the page was clicked once
				problem = name === 'NotAllowedError' ? 'blocked' : 'failed';
				playing = null;
			});
	}
	function toggle(): void {
		if (!named || !audio) return;
		if (playing === named.id) audio.pause();
		else play(named.id);
	}
	/** The pointer came to a take's point, or left the chart (`null`). */
	function over(take: TakeOut | null): void {
		// NOTE: a pinned take keeps the card and the sound to itself
		if (pinned) return;
		clearTimeout(rest);
		if (!take) {
			if (hear) audio?.pause();
			return;
		}
		current = take.id;
		if (hear && playing !== take.id) rest = setTimeout(() => play(take.id), REST_MS);
	}
	/** A click on a take's point pins it to the card; a click on the pinned one lets go. */
	function pin(take: TakeOut | undefined): void {
		if (!take) return;
		pinned = pinned === take.id ? null : take.id;
		current = take.id;
	}
	/** Where the pinned take sits on the time axis of a list of takes; `null` when not on it. */
	function markOf(list: TakeOut[], at: number[]): number | null {
		const index = pinned ? list.findIndex((t) => t.id === pinned) : -1;
		return index < 0 ? null : at[index];
	}
	const mark = $derived(markOf(shown, x));

	$effect(() => {
		if (browser) localStorage.setItem(HEAR_KEY, hear ? 'on' : 'off');
	});
	$effect(() => {
		void fetchAllTakes()
			.then((all) => (takes = all))
			.catch(() => {
				// NOTE: the shell says when the API is away
			});
	});
	onDestroy(() => clearTimeout(rest));
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (pinned = null)} />

<!-- NOTE: one sound for the page: the take the card names -->
<audio
	bind:this={audio}
	preload="none"
	onplay={() => (playing = audio?.dataset.take ?? null)}
	onpause={() => (playing = null)}
	onended={() => (playing = null)}
	data-testid="progress-audio"
></audio>

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
	<DateRange bind:value={range} {earliest} />
</div>
<p class="mb-2 text-sm text-muted-foreground">{i18n.t.progress.intro}</p>
<div
	class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
	data-testid="progress-filters"
>
	{#each INTENTS.toReversed() as intent (intent)}
		<label class="flex items-center gap-2">
			<input type="checkbox" bind:checked={voices[intent]} data-testid="voice-{intent}" />
			{i18n.t.intent[intent]}
		</label>
	{/each}
	<label class="flex items-center gap-2">
		<input type="checkbox" bind:checked={withPractice} data-testid="with-practice" />
		{i18n.t.progress.withPractice}
	</label>
	<label class="flex items-center gap-2">
		<input type="checkbox" bind:checked={hear} data-testid="hear-on-hover" />
		{i18n.t.progress.hear}
	</label>
</div>

{#if kind && kind.item === null}
	<p class="mb-3 max-w-3xl text-sm text-muted-foreground" data-testid="all-kinds-note">
		{i18n.t.progress.allReads}
	</p>
{/if}

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if !shown.length && !drills.length}
	<Empty text={i18n.t.progress.empty} />
{:else}
	<div
		class="sticky top-0 z-20 -mx-2 mb-2 bg-background/80 px-2 py-2 backdrop-blur-sm"
		data-testid="progress-card"
	>
		<TakeCard
			take={named}
			{facts}
			playing={named !== null && playing === named.id}
			pinned={named !== null && pinned === named.id}
			{problem}
			ontoggle={toggle}
			onunpin={() => (pinned = null)}
		/>
	</div>
	<p class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
		{i18n.t.progress.zoomHint}
		{#if zoom}
			<Button size="sm" variant="outline" onclick={() => (zoom = null)} data-testid="zoom-out">
				{i18n.t.progress.zoomOut}
			</Button>
		{/if}
	</p>

	<div class="space-y-8" data-testid="trends">
		{#if grids.length}
			<section data-testid="against-everyday">
				<h2 class="text-xl">{i18n.t.progress.everydayGroup}</h2>
				<p class="mb-2 max-w-3xl text-sm text-muted-foreground">{i18n.t.progress.everydayReads}</p>
				<div class="panel space-y-3">
					{#each grids as grid, index (grid.key)}
						<div data-shift-grid={grid.key}>
							<p class="pl-12 text-xs font-semibold">{i18n.t.progress.grids[grid.key]}</p>
							<Plot
								{x}
								series={grid.series}
								label={i18n.t.progress.grids[grid.key]}
								time
								sync="progress"
								zoomable
								bind:shown={zoom}
								height={grid.key === 'pitch' ? 150 : 190}
								include={grid.key === 'resonance' && zone?.low != null ? [0, zone.low] : [0]}
								zero
								zones={grid.key === 'resonance' && zone && zone.low !== null && zone.high !== null
									? [{ low: zone.low, high: zone.high }]
									: []}
								axis={index === grids.length - 1}
								tick={(value, decimals) => fmtSigned(value, decimals, i18n.locale)}
								tickX={tickTime}
								least={grid.key === 'pitch' ? 2 : 4}
								cursor={mark}
								onhover={(at) => over(at === null ? null : (shown[at] ?? null))}
								onpick={(_at, at) => pin(at === null ? undefined : shown[at])}
							/>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if choices.length > 1 && across && upwards}
			<section data-testid="cross">
				<h2 class="text-xl">{i18n.t.progress.cross}</h2>
				<p class="mb-2 max-w-3xl text-sm text-muted-foreground">{i18n.t.progress.crossReads}</p>
				<div class="panel space-y-2">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
						<label class="flex items-center gap-2">
							{i18n.t.progress.crossY}
							<select class="select" bind:value={crossY} data-testid="cross-y">
								{#each choices as choice (choice.key)}
									<option value={choice.key}>{choice.label}</option>
								{/each}
							</select>
						</label>
						<label class="flex items-center gap-2">
							{i18n.t.progress.crossX}
							<select class="select" bind:value={crossX} data-testid="cross-x">
								{#each choices as choice (choice.key)}
									<option value={choice.key}>{choice.label}</option>
								{/each}
							</select>
						</label>
						<span class="ml-auto font-semibold tabular-nums" data-testid="cross-stat">
							{together === null
								? i18n.t.progress.crossFew
								: i18n.t.progress.crossStat(fmtSigned(together, 2, i18n.locale), cloud.length)}
						</span>
					</div>
					<Scatter
						points={cloud}
						labelX={across.label}
						labelY={upwards.label}
						tick={(value, decimals) => fmtNumber(value, decimals, i18n.locale)}
						picked={named?.id ?? null}
						onhover={(id) => over(id === null ? null : (shown.find((t) => t.id === id) ?? null))}
						onpick={(id) => pin(shown.find((t) => t.id === id))}
					/>
					<ul class="flex flex-wrap gap-x-4 pl-14 text-xs text-muted-foreground">
						{#each INTENTS.toReversed().filter((voice) => voices[voice]) as intent (intent)}
							<li class="flex items-center gap-1.5">
								<span
									class="inline-block size-2.5 rounded-full border-2"
									style="border-color: {ONE}; background: {intent === 'habitual'
										? 'transparent'
										: ONE}"
								></span>
								{i18n.t.intent[intent]}
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{/if}

		{#if sections.length}
			<section data-testid="by-measure">
				<h2 class="text-xl">{i18n.t.progress.measures}</h2>
				{#each sections as section (section.target)}
					<div class="mt-3" data-target={section.target}>
						<h3 class="text-base">{i18n.t.targets[section.target]}</h3>
						<p class="mb-2 max-w-3xl text-sm text-muted-foreground">
							{i18n.t.targets.intro[section.target]}
						</p>
						<div class="grid gap-4 md:grid-cols-2">
							{#each section.metrics as metric (metric.key)}
								{@const series = seriesFor(metric)}
								<Figure
									title={i18n.pick(metric.titles) || metric.key}
									sub={`${i18n.pick(metric.descriptions)} ${i18n.pick(metric.relates)}`}
									table={{
										headers: [i18n.t.progress.taken, i18n.t.intent.label, i18n.pick(metric.titles)],
										rows: shown.flatMap((take) =>
											take.metrics[metric.key] === undefined
												? []
												: [
														[
															fmtDateTime(take.recorded_at, i18n.locale),
															i18n.t.intent[take.intent],
															fmtMetric(take.metrics[metric.key], metric, i18n.locale)
														]
													]
										)
									}}
								>
									<div data-testid="trend" data-metric-trend={metric.key}>
										<Plot
											{x}
											{series}
											label={i18n.pick(metric.titles) || metric.key}
											time
											sync="progress"
											zoomable
											bind:shown={zoom}
											height={160}
											tick={(value, decimals) => fmtNumber(value, decimals, i18n.locale)}
											tickX={tickTime}
											least={4 * 10 ** -metric.decimals}
											cursor={mark}
											onhover={(at) => over(at === null ? null : (shown[at] ?? null))}
											onpick={(_at, at) => pin(at === null ? undefined : shown[at])}
										/>
									</div>
								</Figure>
							{/each}
						</div>
					</div>
				{/each}
			</section>
		{/if}

		{#if drills.length}
			<section data-testid="drills">
				<h2 class="text-xl">{i18n.t.progress.drills}</h2>
				<p class="mb-2 max-w-3xl text-sm text-muted-foreground">{i18n.t.progress.drillsReads}</p>
				<div class="space-y-4">
					{#each drills as drill (drill.exercise.id)}
						<div class="panel" data-drill={drill.exercise.id}>
							<h3 class="mb-2 text-base">
								{i18n.pick(drill.exercise.titles)}
								<span class="text-sm font-normal text-muted-foreground">({drill.reps.length})</span>
							</h3>
							<div class="grid gap-x-6 gap-y-3 md:grid-cols-2">
								{#each drill.measures as measure (measure.key)}
									<div data-drill-measure={measure.key}>
										<p class="pl-12 text-xs font-semibold">{measure.title}</p>
										<Plot
											x={drill.x}
											series={measure.series}
											label={measure.title}
											time
											sync="progress"
											zoomable
											bind:shown={zoom}
											height={140}
											tick={measure.text}
											tickX={tickTime}
											least={measure.least}
											cursor={markOf(drill.reps, drill.x)}
											onhover={(at) => over(at === null ? null : (drill.reps[at] ?? null))}
											onpick={(_at, at) => pin(at === null ? undefined : drill.reps[at])}
										/>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
{/if}
