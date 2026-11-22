<script lang="ts">
	// Progress: the takes as statistics, for one microphone setup and one
	// kind of take (or all kinds, as distances from the everyday voice) over
	// a chosen stretch of time. Four tabs: the takes against the everyday
	// voice (the numbers that matter as tiles, over time, and how each voice
	// spreads), every measurement by itself, the measures against each
	// other, and what each exercise was judged on. A point is a take: the
	// pointer names it, a click plays it in the dock with the chart's takes
	// as the list. Every chart opens over the whole screen and gives its
	// numbers as a table and a file. The view is kept in the address.
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import { fetchAllTakes } from '#lib/api/index.js';
	import type { Item, MeasureDef, MetricDef, TakeOut, Zone } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import type { Voice } from '#lib/charts.js';
	import DateRange from '#lib/components/app/DateRange.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import Help from '#lib/components/app/Help.svelte';
	import VoiceMark from '#lib/components/app/VoiceMark.svelte';
	import ChartCard, {
		type ChartFrame,
		type ChartTable
	} from '#lib/components/charts/ChartCard.svelte';
	import StatTile from '#lib/components/charts/StatTile.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { fmtDateTime, fmtDuration, fmtMetric, fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { player } from '#lib/player.svelte.js';
	import {
		matrixOption,
		scatterOption,
		spreadOption,
		trendOption,
		type Datum,
		type Dot,
		type Line,
		type Pair,
		type Panel,
		type Scale,
		type ZoneBand
	} from '#lib/progress/options.js';
	import { colours } from '#lib/progress/palette.svelte.js';
	import { tipCard, type TipRow } from '#lib/progress/tip.js';
	import { decodeRange, encodeRange, inRange } from '#lib/range.js';
	import { median, pearson } from '#lib/stats.js';
	import { ROLE, TARGETS, shiftOf } from '#lib/targets.js';
	import { cn } from '#lib/utils.js';
	import { ViewState } from '#lib/view.svelte.js';

	type Kind = {
		key: string;
		item: Item | null;
		language: string | null;
		label: string;
		count: number;
	};
	/** A number a take has, to put on an axis. */
	type Choice = Scale & {
		key: string;
		of: (take: TakeOut) => number | null;
		text: (value: number) => string;
	};

	const VOICES: Voice[] = ['attempt', 'habitual'];
	const TABS = ['voice', 'measures', 'relations', 'exercises'] as const;
	/** The distances from the everyday voice, with the hue each keeps on every chart. */
	const SHIFTS = [
		'pitch_shift_st',
		'brightness_pct',
		'r1_shift_pct',
		'lightness_shift_db',
		'level_shift_db',
		'clarity_shift_db'
	];
	/** Recording-quality numbers say nothing about the voice; they stay on the take's page. */
	const SKIP = new Set(['recording']);
	/** The least a distance's axis spans, by unit: less is not blown up. */
	const LEAST: Record<string, number> = { st: 2, '%': 6, dB: 4 };

	const view = new ViewState('progress', {
		tab: 'voice',
		mic: '',
		kind: '',
		range: 'all',
		voices: ['attempt', 'habitual'],
		practice: false,
		by: 'take',
		x: 'lightness_shift_db',
		y: 'brightness_pct'
	});
	const v = view.value;

	let takes = $state.raw<TakeOut[] | null>(null);
	/** The takes inside the scatter's selection rectangle. */
	let picked = $state.raw<string[]>([]);
	const now = Date.now();

	/** The tab that is open; only its charts are drawn. */
	const tab = $derived((TABS as readonly string[]).includes(v.tab) ? v.tab : 'voice');
	const palette = $derived(colours.value);
	const hue = (key: string) => palette.series[Math.max(SHIFTS.indexOf(key), 0)];
	const range = $derived(decodeRange(v.range));
	const device = $derived(app.devices.find((d) => `${d.id}` === v.mic) ?? app.devices[0] ?? null);
	const at = (take: TakeOut) => Date.parse(take.recorded_at);

	/** Everything on this setup in the chosen stretch of time, oldest first. */
	const scope = $derived(
		(takes ?? [])
			.filter((t) => t.device_id === device?.id && inRange(range, at(t), now))
			.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
	);
	/** The takes that speak for a voice: from the Record page, and practice attempts when asked for. */
	const voiced = $derived(
		scope.filter((t) => t.intent !== 'drill' && (v.practice || !t.exercise_ref))
	);
	const kinds = $derived.by(() => {
		const found: Record<string, Kind> = {};
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
		const list = Object.values(found).sort((a, b) => b.count - a.count);
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
	const kind = $derived(kinds.find((k) => k.key === v.kind) ?? kinds[0] ?? null);
	/** The takes the charts of a voice show. */
	const shown = $derived(
		voiced.filter(
			(t) =>
				kind !== null &&
				(kind.item === null
					? Boolean(t.reading?.shifts.length)
					: t.item === kind.item && t.language === kind.language) &&
				v.voices.includes(t.intent) &&
				Object.keys(t.metrics).length > 0
		)
	);
	const byId = $derived(Object.fromEntries((takes ?? []).map((t) => [t.id, t])));
	const earliest = $derived(takes?.length ? Math.min(...takes.map(at)) : null);
	/** The take in the dock, as a moment to mark on the charts that hold it. */
	const playing = $derived(player.take);
	const mark = $derived(playing && shown.some((t) => t.id === playing.id) ? at(playing) : null);

	const def = (key: string): MeasureDef | undefined => app.measures.find((m) => m.key === key);
	const title = (key: string) => i18n.pick(def(key)?.titles) || key;
	const amount = (value: number, key: string) =>
		`${fmtSigned(value, def(key)?.decimals ?? 1, i18n.locale)} ${def(key)?.unit ?? ''}`.trim();
	const zonesOf = (zones: Zone[] | undefined): ZoneBand[] =>
		(zones ?? []).map((zone) => ({
			low: zone.low,
			high: zone.high,
			label: i18n.pick(zone.titles),
			tone: zone.key === 'typical' ? 'good' : 'warning'
		}));
	const voiceOf = (take: TakeOut): Voice => (take.intent === 'attempt' ? 'attempt' : 'habitual');

	/** One distance over the takes, a line per voice. */
	function lines(key: string, list: TakeOut[] = shown): Line[] {
		return VOICES.map((voice) => ({
			key: `${key}:${voice}`,
			name: title(key),
			color: hue(key),
			voice,
			dots: list.flatMap((take): Dot[] => {
				const shift = take.intent === voice ? shiftOf(take.reading, key) : null;
				return shift ? [{ id: take.id, at: at(take), value: shift.value }] : [];
			})
		})).filter((line) => line.dots.length);
	}
	const shiftPanel = (key: string, weight = 1): Panel => ({
		key,
		title: title(key),
		unit: def(key)?.unit ?? '',
		signed: true,
		least: LEAST[def(key)?.unit ?? ''] ?? 0,
		zones: zonesOf(def(key)?.zones),
		lines: lines(key),
		weight
	});
	/** The takes against the everyday voice: pitch, each resonance with its range, the source. */
	const panels = $derived<Panel[]>([
		shiftPanel('pitch_shift_st'),
		shiftPanel('brightness_pct', 1.15),
		shiftPanel('r1_shift_pct', 1.15),
		{
			key: 'source',
			title: i18n.t.progress.source,
			unit: 'dB',
			signed: true,
			least: LEAST.dB,
			lines: ['lightness_shift_db', 'level_shift_db', 'clarity_shift_db'].flatMap((key) =>
				lines(key)
			),
			weight: 1.25
		}
	]);
	const drawn = $derived(panels.filter((panel) => panel.lines.length));

	// --- what the pointer says about a take, and what a click does with it
	function takeTip(take: TakeOut, extra: TipRow[] = []): HTMLElement {
		const exercise = app.exerciseOf(take.exercise_ref);
		const what =
			(exercise ? i18n.pick(exercise.titles) : i18n.t.item[take.item]) +
			(take.language ? `, ${i18n.language(take.language)}` : '');
		const passage = app.passage(take.content_ref)?.title;
		const shifts: TipRow[] = (take.reading?.shifts ?? []).map((shift) => ({
			label: title(shift.key),
			value: amount(shift.value, shift.key),
			color: hue(shift.key)
		}));
		const judged: TipRow[] = (take.evaluation?.measures ?? []).map((m) => {
			const measure = app.measure(m.key);
			return {
				label: measure ? i18n.pick(measure.titles) : m.key,
				value:
					`${fmtNumber(m.value, measure?.decimals ?? 1, i18n.locale)} ${measure?.unit ?? ''}`.trim(),
				color: m.met === true ? palette.good : m.met === false ? palette.muted : undefined
			};
		});
		return tipCard({
			title: fmtDateTime(take.recorded_at, i18n.locale),
			sub: [i18n.t.intent[take.intent], what, passage, fmtDuration(take.duration_s)]
				.filter(Boolean)
				.join(' · '),
			rows: [
				...extra,
				...(shifts.length ? shifts : judged),
				...(take.comfort !== null
					? [
							{
								label: i18n.t.takes.comfort,
								value: `${take.comfort} · ${i18n.t.practice.run.comforts[take.comfort - 1]}`
							}
						]
					: [])
			],
			note: take.note
				? take.note.length > 140
					? `${take.note.slice(0, 140)}…`
					: take.note
				: undefined,
			foot: i18n.t.progress.clickToListen
		});
	}
	function tip(datum: Datum): HTMLElement | string {
		const one = datum.take ? byId[datum.take] : null;
		if (one) return takeTip(one);
		const several = (datum.takes ?? []).flatMap((id) => byId[id] ?? []);
		if (!several.length) return '';
		return tipCard({
			title: new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
				dateStyle: 'medium'
			}).format(new Date(several[0].recorded_at)),
			sub: i18n.t.progress.dayTakes(several.length),
			foot: i18n.t.progress.clickToListen
		});
	}
	/** A click on a datum: play its take with the chart's takes as the list, or a day's takes. */
	function pick(list: TakeOut[]) {
		return (event: { data?: unknown }) => {
			const datum = (event.data ?? {}) as Datum;
			const one = datum.take ? byId[datum.take] : null;
			if (one) return player.play(one, list.some((t) => t.id === one.id) ? list : [one]);
			const several = (datum.takes ?? []).flatMap((id) => byId[id] ?? []);
			if (several.length) player.play(several[0], several);
		};
	}

	/** A number as a table and a file keep it: three decimals are more than any measure has. */
	const round = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 1000);
	/** A chart of takes as rows: when, which voice, and each line's value. */
	function tableOf(
		list: TakeOut[],
		columns: { header: string; of: (take: TakeOut) => number | null }[]
	) {
		return (): ChartTable => ({
			headers: [i18n.t.progress.taken, i18n.t.intent.label, ...columns.map((c) => c.header)],
			rows: list
				.filter((take) => columns.some((c) => c.of(take) !== null))
				.map((take) => [
					fmtDateTime(take.recorded_at, i18n.locale),
					i18n.t.intent[take.intent],
					...columns.map((c) => round(c.of(take)))
				])
		});
	}
	const shiftColumn = (key: string) => ({
		header: `${title(key)} (${def(key)?.unit ?? ''})`,
		of: (take: TakeOut) => shiftOf(take.reading, key)?.value ?? null
	});

	// --- the numbers that matter, as tiles: the attempts' distances
	const tiles = $derived(
		SHIFTS.map((key) => {
			const values = shown.flatMap((take) =>
				take.intent === 'attempt' ? (shiftOf(take.reading, key)?.value ?? []) : []
			);
			const latest = values.at(-1);
			const before = values.at(-2);
			const zone = def(key)?.zones.find((z) => z.key === 'typical');
			/** There are attempts, but none whose first resonance can be read. */
			const unread =
				key === 'r1_shift_pct' &&
				shown.some((t) => t.intent === 'attempt' && t.reading?.notes.includes('r1-unreadable'));
			return {
				key,
				values,
				value: latest === undefined ? '–' : fmtSigned(latest, def(key)?.decimals ?? 1, i18n.locale),
				delta:
					latest !== undefined && before !== undefined
						? {
								text: amount(Math.abs(latest - before), key).replace(/^[+−-]/, ''),
								up: latest >= before,
								title: i18n.t.progress.before
							}
						: null,
				note: values.length
					? i18n.t.progress.middle(values.length, amount(median(values), key))
					: unread
						? i18n.t.progress.unreadable
						: i18n.t.progress.noAttempt,
				zone:
					zone && zone.low !== null && zone.high !== null
						? { low: zone.low, high: zone.high }
						: null
			};
		})
	);

	// --- every measurement by itself
	const metrics = $derived(
		kind?.item
			? app
					.groups(kind.item)
					.filter((g) => !SKIP.has(g.group))
					.flatMap((g) => g.metrics)
					.filter((m) => shown.some((t) => t.metrics[m.key] !== undefined))
			: []
	);
	const sections = $derived(
		TARGETS.map((target) => ({
			target,
			metrics: metrics.filter((m) => ROLE[m.group] === target)
		})).filter((s) => s.metrics.length)
	);
	function metricPanel(metric: MetricDef): Panel {
		const band = app.band;
		return {
			key: metric.key,
			title: '',
			unit: '',
			least: 4 * 10 ** -metric.decimals,
			// NOTE: a pitch in Hz is read against the band the learner practises in
			zones:
				band && metric.group === 'pitch' && metric.unit === 'Hz'
					? [
							{
								low: band.low_hz,
								high: band.high_hz,
								label: i18n.t.progress.yourBand,
								tone: 'band'
							}
						]
					: [],
			lines: VOICES.map((voice) => ({
				key: voice,
				name: i18n.t.intent[voice],
				color: palette.series[0],
				voice,
				dots: shown.flatMap((take): Dot[] =>
					take.intent === voice && take.metrics[metric.key] !== undefined
						? [{ id: take.id, at: at(take), value: take.metrics[metric.key] }]
						: []
				)
			})).filter((line) => line.dots.length)
		};
	}

	// --- the measures against each other
	const choices = $derived<Choice[]>([
		...SHIFTS.filter((key) => shown.some((t) => shiftOf(t.reading, key))).map((key) => ({
			key,
			title: i18n.t.takes.shifts[key] ?? title(key),
			unit: def(key)?.unit ?? '',
			signed: true,
			zones: zonesOf(def(key)?.zones),
			of: (take: TakeOut) => shiftOf(take.reading, key)?.value ?? null,
			text: (value: number) => amount(value, key)
		})),
		...metrics.map((metric) => ({
			key: metric.key,
			title: i18n.pick(metric.titles) || metric.key,
			unit: metric.unit,
			of: (take: TakeOut) => take.metrics[metric.key] ?? null,
			text: (value: number) => fmtMetric(value, metric, i18n.locale)
		}))
	]);
	const across = $derived(choices.find((c) => c.key === v.x) ?? choices[0] ?? null);
	const upwards = $derived(
		choices.find((c) => c.key === v.y && c !== across) ?? choices.find((c) => c !== across) ?? null
	);
	const cloud = $derived<Pair[]>(
		across && upwards
			? shown.flatMap((take): Pair[] => {
					const [x, y] = [across.of(take), upwards.of(take)];
					return x === null || y === null ? [] : [{ id: take.id, x, y, voice: voiceOf(take) }];
				})
			: []
	);
	const together = $derived(pearson(cloud.map((p) => [p.x, p.y] as const)));
	/** The distances against each other: r and the number of takes for every pair. */
	const grid = $derived.by(() => {
		const list = choices.filter((c) => SHIFTS.includes(c.key));
		return {
			list,
			cells: list.flatMap((a, x) =>
				list.map((b, y) => {
					const pairs = shown.flatMap((take): [number, number][] => {
						const [p, q] = [a.of(take), b.of(take)];
						return p === null || q === null ? [] : [[p, q]];
					});
					return { x, y, r: pearson(pairs), n: pairs.length };
				})
			)
		};
	});
	const inBox = $derived(picked.flatMap((id) => byId[id] ?? []));

	// --- what each exercise was judged on
	const drills = $derived(
		(app.content?.exercises ?? []).flatMap((exercise) => {
			const reps = scope.filter(
				(t) => app.exerciseOf(t.exercise_ref)?.id === exercise.id && t.evaluation?.measures.length
			);
			if (!reps.length) return [];
			const keys = [...new Set(reps.flatMap((t) => t.evaluation!.measures.map((m) => m.key)))];
			const found = (take: TakeOut, key: string) =>
				take.evaluation?.measures.find((m) => m.key === key) ?? null;
			return [
				{
					exercise,
					reps,
					met: reps.filter((t) => t.evaluation?.met === true).length,
					columns: keys.map((key) => {
						const measure = app.measure(key);
						return {
							header: `${measure ? i18n.pick(measure.titles) : key} (${measure?.unit ?? ''})`,
							of: (take: TakeOut) => found(take, key)?.value ?? null
						};
					}),
					panels: keys.map((key): Panel => {
						const measure = app.measure(key);
						const latest = reps.map((t) => found(t, key)).findLast((m) => m !== null);
						const unit = measure?.unit ?? '';
						const bar = (value: number) =>
							`${fmtNumber(value, measure?.decimals ?? 1, i18n.locale)} ${unit}`.trim();
						return {
							key,
							title: measure ? i18n.pick(measure.titles) : key,
							unit,
							// NOTE: offsets and steps are distances; shares, seconds and pitches are amounts
							signed: /^(note_offset|hold_offset|step_|whisper_)/.test(key),
							least: 4 * 10 ** -(measure?.decimals ?? 1),
							bars: [
								...(latest?.low != null
									? [{ value: latest.low, label: i18n.t.progress.atLeast(bar(latest.low)) }]
									: []),
								...(latest?.high != null
									? [{ value: latest.high, label: i18n.t.progress.atMost(bar(latest.high)) }]
									: [])
							],
							lines: [
								{
									key,
									name: measure ? i18n.pick(measure.titles) : key,
									color: palette.series[0],
									voice: exercise.intent === 'drill' ? 'drill' : 'attempt',
									dots: reps.flatMap((take): Dot[] => {
										const m = found(take, key);
										return m
											? [
													{
														id: take.id,
														at: at(take),
														value: m.value,
														tone: m.met === true ? 'met' : m.met === false ? 'missed' : undefined
													}
												]
											: [];
									})
								}
							]
						};
					})
				}
			];
		})
	);

	const frameOf = (
		panels: Panel[],
		frame: ChartFrame,
		extra: Partial<Parameters<typeof trendOption>[0]> = {}
	) => trendOption({ panels, palette, frame, locale: i18n.locale, tip, ...extra });

	$effect(() => {
		void fetchAllTakes()
			.then((all) => (takes = all))
			.catch(() => {
				// NOTE: the shell says when the API is away
			});
	});
</script>

{#snippet voiceKey()}
	<ul class="space-y-1 text-sm text-muted-foreground">
		{#each VOICES as voice (voice)}
			<li class="flex items-center gap-2">
				<VoiceMark intent={voice} class="text-foreground" />
				{i18n.t.intent[voice]}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="mb-3 flex flex-wrap items-center gap-2" data-testid="progress-filters">
	<h1 class="text-2xl">{i18n.t.progress.title}</h1>
	<Help title={i18n.t.progress.title} text={i18n.t.progress.help.page} wide
		>{@render voiceKey()}</Help
	>
	<div class="ms-auto flex flex-wrap items-center gap-2">
		{#if app.devices.length > 1}
			<select
				class="select h-8"
				aria-label={i18n.t.takes.device}
				value={device ? `${device.id}` : ''}
				onchange={(event) => (v.mic = event.currentTarget.value)}
			>
				{#each app.devices as option (option.id)}
					<option value={`${option.id}`}>{option.name}</option>
				{/each}
			</select>
		{/if}
		{#if kinds.length}
			<select
				class="select h-8"
				aria-label={i18n.t.progress.kind}
				value={kind?.key}
				onchange={(event) => (v.kind = event.currentTarget.value)}
				data-testid="kind"
			>
				{#each kinds as option (option.key)}
					<option value={option.key}>{option.label} ({option.count})</option>
				{/each}
			</select>
		{/if}
		<DateRange bind:value={() => range, (next) => (v.range = encodeRange(next))} {earliest} />
		<div class="flex items-center gap-1" role="group" aria-label={i18n.t.intent.label}>
			{#each VOICES as voice (voice)}
				{@const on = v.voices.includes(voice)}
				<Button
					variant={on ? 'secondary' : 'outline'}
					size="sm"
					class={cn('h-8 gap-1.5', !on && 'text-muted-foreground line-through decoration-1')}
					aria-pressed={on}
					onclick={() =>
						(v.voices = on ? v.voices.filter((x) => x !== voice) : [...v.voices, voice])}
					data-testid="voice-{voice}"
				>
					<VoiceMark intent={voice} />
					{i18n.t.intent[voice]}
				</Button>
			{/each}
		</div>
		<label class="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm">
			<input
				type="checkbox"
				class="accent-primary"
				bind:checked={v.practice}
				data-testid="with-practice"
			/>
			{i18n.t.progress.practice}
		</label>
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
	</div>
</div>

{#if takes === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if !shown.length && !drills.length}
	<Empty text={i18n.t.progress.empty} />
{:else}
	<Tabs.Root value={tab} onValueChange={(next) => (v.tab = next)}>
		<Tabs.List class="mb-3">
			{#each TABS as tab (tab)}
				<Tabs.Trigger value={tab} data-testid="tab-{tab}">{i18n.t.progress.tabs[tab]}</Tabs.Trigger>
			{/each}
		</Tabs.List>

		{#if tab === 'voice'}
			<div role="tabpanel" data-testid="panel-voice">
				{#if !drawn.length}
					<Empty text={i18n.t.progress.noReading} />
				{:else}
					<div class="space-y-3" data-testid="against-everyday">
						<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="tiles">
							{#each tiles as tile (tile.key)}
								<StatTile
									title={title(tile.key)}
									value={tile.value}
									unit={def(tile.key)?.unit}
									delta={tile.delta}
									note={tile.note}
									trail={tile.values}
									color={hue(tile.key)}
									zone={tile.zone}
								>
									<Help
										title={title(tile.key)}
										text={[i18n.pick(def(tile.key)?.descriptions), i18n.t.progress.help.tile]}
									/>
								</StatTile>
							{/each}
						</div>
						<ChartCard
							title={i18n.t.progress.trend}
							sub={i18n.t.progress.takes(shown.length)}
							help={{ text: i18n.t.progress.help.trend, children: voiceKey }}
							name="against-everyday"
							height={150 + 150 * drawn.length}
							option={(frame) =>
								frameOf(panels, frame, {
									by: v.by === 'day' ? 'day' : 'take',
									mark,
									slider: true,
									legend: true
								})}
							table={tableOf(shown, SHIFTS.map(shiftColumn))}
							onpick={pick(shown)}
						>
							{#snippet controls()}
								<div
									class="flex rounded-lg border p-0.5"
									role="group"
									aria-label={i18n.t.progress.by}
								>
									{#each ['take', 'day'] as const as by (by)}
										<button
											type="button"
											class={cn(
												'rounded-md px-2 py-0.5 text-xs font-bold',
												v.by === by
													? 'bg-secondary text-secondary-foreground'
													: 'text-muted-foreground hover:text-foreground'
											)}
											aria-pressed={v.by === by}
											onclick={() => (v.by = by)}
											data-testid="by-{by}"
										>
											{i18n.t.progress.bys[by]}
										</button>
									{/each}
								</div>
							{/snippet}
						</ChartCard>
						<div>
							<h2 class="mb-2 flex items-center gap-1.5 text-base">
								{i18n.t.progress.spread}
								<Help title={i18n.t.progress.spread} text={i18n.t.progress.help.spread} />
							</h2>
							<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="spreads">
								{#each SHIFTS.filter( (key) => shown.some( (t) => shiftOf(t.reading, key) ) ) as key (key)}
									<ChartCard
										title={title(key)}
										sub={def(key)?.unit}
										name="spread-{key}"
										height={130}
										option={() =>
											spreadOption({
												scale: {
													title: title(key),
													unit: def(key)?.unit ?? '',
													signed: true,
													zones: zonesOf(def(key)?.zones)
												},
												rows: VOICES.toReversed().map((voice) => ({
													name: i18n.t.intent[voice],
													voice,
													dots: shown.flatMap((take): Dot[] => {
														const shift = take.intent === voice ? shiftOf(take.reading, key) : null;
														return shift ? [{ id: take.id, at: at(take), value: shift.value }] : [];
													})
												})),
												palette,
												locale: i18n.locale,
												mark: playing?.id,
												tip
											})}
										table={tableOf(shown, [shiftColumn(key)])}
										onpick={pick(shown)}
									/>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if tab === 'measures'}
			<div role="tabpanel" data-testid="panel-measures">
				{#if !sections.length}
					<Empty text={kind?.item === null ? i18n.t.progress.oneKind : i18n.t.progress.empty} />
				{:else}
					<div class="space-y-5" data-testid="trends">
						{#each sections as section (section.target)}
							<section data-target={section.target}>
								<h2 class="mb-2 flex items-center gap-1.5 text-base">
									{i18n.t.targets[section.target]}
									<Help
										title={i18n.t.targets[section.target]}
										text={i18n.t.targets.intro[section.target]}
									/>
								</h2>
								<div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
									{#each section.metrics as metric (metric.key)}
										<ChartCard
											title={i18n.pick(metric.titles) || metric.key}
											sub={metric.unit}
											help={{
												text: [
													i18n.pick(metric.descriptions),
													i18n.pick(metric.relates),
													i18n.pick(metric.notes)
												]
											}}
											name={metric.key}
											height={190}
											group="measures"
											option={(frame) =>
												frameOf([metricPanel(metric)], frame, { mark, slider: frame.full })}
											table={tableOf(shown, [
												{
													header: `${i18n.pick(metric.titles)} (${metric.unit})`,
													of: (take) => take.metrics[metric.key] ?? null
												}
											])}
											onpick={pick(shown)}
										/>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if tab === 'relations'}
			<div role="tabpanel" data-testid="panel-relations">
				{#if !across || !upwards}
					<Empty text={i18n.t.progress.noReading} />
				{:else}
					<div class="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="cross">
						<ChartCard
							title={i18n.t.progress.matrix}
							sub={i18n.t.progress.takes(shown.length)}
							help={{ text: i18n.t.progress.help.matrix }}
							name="relations"
							height={Math.max(260, 56 * grid.list.length + 60)}
							option={() =>
								matrixOption({
									names: grid.list.map((c) => c.title),
									cells: grid.cells,
									palette,
									locale: i18n.locale,
									picked: [grid.list.indexOf(across), grid.list.indexOf(upwards)],
									tip: (datum) => {
										const [x, y, r, n] = datum.value as number[];
										return tipCard({
											title: `${grid.list[y].title} · ${grid.list[x].title}`,
											rows: [
												{ label: 'r', value: fmtSigned(r, 2, i18n.locale) },
												{ label: i18n.t.takes.title, value: `${n}` }
											],
											foot: i18n.t.progress.clickToPlot
										});
									}
								})}
							table={() => ({
								headers: ['', ...grid.list.map((c) => c.title)],
								rows: grid.list.map((row, y) => [
									row.title,
									...grid.list.map((_, x) => {
										const cell = grid.cells.find((c) => c.x === x && c.y === y);
										return cell?.r == null ? null : Math.round(cell.r * 100) / 100;
									})
								])
							})}
							onpick={(event) => {
								const value = (event.data as { value?: number[] } | undefined)?.value;
								if (!value) return;
								[v.x, v.y] = [grid.list[value[0]].key, grid.list[value[1]].key];
							}}
						/>
						<ChartCard
							title={i18n.t.progress.scatter}
							sub={together === null
								? i18n.t.progress.few
								: i18n.t.progress.stat(fmtSigned(together, 2, i18n.locale), cloud.length)}
							help={{ text: i18n.t.progress.help.scatter, children: voiceKey }}
							name="scatter"
							height={420}
							option={() =>
								scatterOption({
									x: across,
									y: upwards,
									points: cloud,
									palette,
									locale: i18n.locale,
									mark: playing?.id,
									select: true,
									tip: (datum) => {
										const take = datum.take ? byId[datum.take] : null;
										return take ? takeTip(take) : '';
									}
								})}
							table={tableOf(shown, [
								{ header: `${across.title} (${across.unit})`, of: across.of },
								{ header: `${upwards.title} (${upwards.unit})`, of: upwards.of }
							])}
							onpick={pick(shown)}
							onselect={(ids) => (picked = ids)}
						>
							{#snippet controls()}
								<label class="flex items-center gap-1 text-xs text-muted-foreground">
									{i18n.t.progress.upwards}
									<select
										class="select h-7 max-w-44 px-1 text-xs"
										bind:value={v.y}
										data-testid="cross-y"
									>
										{#each choices as choice (choice.key)}
											<option value={choice.key}>{choice.title}</option>
										{/each}
									</select>
								</label>
								<label class="flex items-center gap-1 text-xs text-muted-foreground">
									{i18n.t.progress.across}
									<select
										class="select h-7 max-w-44 px-1 text-xs"
										bind:value={v.x}
										data-testid="cross-x"
									>
										{#each choices as choice (choice.key)}
											<option value={choice.key}>{choice.title}</option>
										{/each}
									</select>
								</label>
							{/snippet}
							{#snippet footer()}
								{#if inBox.length}
									<div
										class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm"
										data-testid="cross-picked"
									>
										<span class="font-bold tabular-nums">{i18n.t.progress.inBox(inBox.length)}</span
										>
										<Button size="sm" onclick={() => player.play(inBox[0], inBox)}>
											{i18n.t.takes.listen}
										</Button>
									</div>
								{/if}
							{/snippet}
						</ChartCard>
					</div>
				{/if}
			</div>
		{/if}

		{#if tab === 'exercises'}
			<div role="tabpanel" data-testid="panel-exercises">
				{#if !drills.length}
					<Empty text={i18n.t.progress.noDrills} />
				{:else}
					<div class="grid gap-3 xl:grid-cols-2" data-testid="drills">
						{#each drills as drill (drill.exercise.id)}
							<div data-drill={drill.exercise.id}>
								<ChartCard
									title={i18n.pick(drill.exercise.titles)}
									sub={i18n.t.progress.reps(drill.reps.length, drill.met)}
									help={{
										text: [i18n.pick(drill.exercise.summaries), i18n.t.progress.help.exercises]
									}}
									name="exercise-{drill.exercise.id}"
									height={70 + 130 * drill.panels.length}
									option={(frame) =>
										frameOf(drill.panels, frame, {
											mark:
												playing && drill.reps.some((t) => t.id === playing.id) ? at(playing) : null,
											slider: frame.full
										})}
									table={tableOf(drill.reps, drill.columns)}
									onpick={pick(drill.reps)}
								/>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</Tabs.Root>
{/if}
