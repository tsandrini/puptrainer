<script lang="ts">
	// Two takes against each other: their graphs overlaid moment by moment
	// (the second can be moved, or lined up by its sounds), both players with
	// a switch that goes on in the other take at the same place, and every
	// measurement they share with the difference between them.
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import { page } from '$app/state';
	import { fetchTake, fetchTrace, takeAudioUrl } from '#lib/api/index.js';
	import type { TakeOut, Trace } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import CompareTraces from '#lib/components/audio/CompareTraces.svelte';
	import TakePlayer from '#lib/components/audio/TakePlayer.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import Help from '#lib/components/app/Help.svelte';
	import PersonMark from '#lib/components/app/PersonMark.svelte';
	import VoiceMark from '#lib/components/app/VoiceMark.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { alignSteps } from '#lib/compare.js';
	import { fmtDateTime, fmtMetric, fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { shapeOf } from '#lib/people.js';

	type Side = 'a' | 'b';
	const NUDGE_S = 0.1;

	const ids = $derived([page.url.searchParams.get('a'), page.url.searchParams.get('b')]);
	let pair = $state.raw<[TakeOut, TakeOut] | null>(null);
	let traces = $state.raw<[Trace | null, Trace | null]>([null, null]);
	/** The graphs have been asked for and answered: a missing one is missing, not on its way. */
	let traced = $state(false);
	let failed = $state(false);
	/** How far the second take is moved along the first one's clock, in seconds. */
	let shift = $state(0);

	let players = $state<Record<Side, TakePlayer | null>>({ a: null, b: null });
	let positions = $state<Record<Side, number>>({ a: 0, b: 0 });
	let sounding = $state<Record<Side, boolean>>({ a: false, b: false });
	/** The take that sounds, or sounded last: the graphs' marker follows it. */
	let last = $state<Side>('a');

	/** The moment the marker stands at, on the first take's clock. */
	const position = $derived(last === 'b' ? positions.b + shift : positions.a);
	const groups = $derived.by(() => {
		if (!pair) return [];
		const [a, b] = pair;
		return app
			.groups(a.item)
			.map((g) => ({
				...g,
				metrics: g.metrics.filter(
					(m) => a.metrics[m.key] !== undefined && b.metrics[m.key] !== undefined
				)
			}))
			.filter((g) => g.metrics.length);
	});

	const title = (take: TakeOut) =>
		(app.exerciseOf(take.exercise_ref)
			? i18n.pick(app.exerciseOf(take.exercise_ref)?.titles)
			: i18n.t.item[take.item]) + (take.language ? `, ${i18n.language(take.language)}` : '');

	/** A difference with its sign: `+3 Hz`, `−0.4 cm`. */
	function delta(value: number, decimals: number, unit: string): string {
		const text = fmtNumber(Math.abs(value), decimals, i18n.locale);
		const zero = Number(text.replace(',', '.')) === 0;
		return `${zero ? '±' : value > 0 ? '+' : '−'}${text}${unit ? ` ${unit}` : ''}`;
	}

	/** Both players to one moment of the first take's clock. */
	function seek(seconds: number): void {
		players.a?.seek(seconds);
		players.b?.seek(seconds - shift);
	}

	/** Go on in the other take at the same place. */
	function swap(): void {
		const to: Side = last === 'a' ? 'b' : 'a';
		const moment = position;
		players[last]?.pause();
		players[to]?.seek(to === 'b' ? moment - shift : moment);
		players[to]?.play();
		last = to;
	}

	/** Move the second take so that its first sound starts with the first one's. */
	function align(): void {
		const level = (trace: Trace | null) => trace?.rows.find((r) => r.key === 'level_db')?.values;
		const [a, b] = [level(traces[0]), level(traces[1])];
		const step = traces[0]?.step_s ?? 0.1;
		if (!a || !b) return;
		const starts = (traces[0]?.start_s ?? 0) - (traces[1]?.start_s ?? 0);
		shift = Math.round((alignSteps(a, b) * step + starts) * 100) / 100;
	}

	$effect(() => {
		if (sounding.a) last = 'a';
		else if (sounding.b) last = 'b';
	});

	$effect(() => {
		const [a, b] = ids;
		pair = null;
		traces = [null, null];
		traced = false;
		failed = false;
		shift = 0;
		if (!a || !b) return;
		let stale = false;
		void Promise.all([fetchTake(a), fetchTake(b)])
			.then(async (both) => {
				if (stale) return;
				pair = both;
				const found = await Promise.all(
					both.map((take) => (take.series.length ? fetchTrace(take.id).catch(() => null) : null))
				);
				if (stale) return;
				traces = [found[0], found[1]];
				traced = true;
			})
			.catch(() => (failed = true));
		return () => (stale = true);
	});
</script>

<svelte:window
	onkeydown={(event) => {
		// NOTE: X goes on in the other take
		if (event.key.toLowerCase() !== 'x' || event.ctrlKey || event.metaKey || event.altKey) return;
		if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
			return;
		if (pair) swap();
	}}
/>

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h1 class="text-2xl">{i18n.t.compare.title}</h1>
	<Help title={i18n.t.compare.title} text={i18n.t.compare.help} wide />
	<Button href="/" variant="outline" size="sm" class="ms-auto">{i18n.t.compare.back}</Button>
</div>

{#if !ids[0] || !ids[1]}
	<Empty text={i18n.t.compare.pick} />
{:else if failed}
	<div data-testid="compare-failed"><Empty text={i18n.t.compare.failed} /></div>
{:else if pair === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else}
	{@const [a, b] = pair}
	{@const sides = [
		{ side: 'a' as Side, name: 'A', take: a },
		{ side: 'b' as Side, name: 'B', take: b }
	]}
	{#if a.device_id !== b.device_id}
		<p class="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
			{i18n.t.compare.setups}
		</p>
	{/if}
	{#if a.item !== b.item}
		<p class="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
			{i18n.t.compare.kinds}
		</p>
	{/if}

	<div class="mb-4 flex flex-wrap items-center gap-2" data-testid="compare-sides">
		{#each sides as { side, name, take }, index (side)}
			{#if index === 1}
				<Button
					variant="ghost"
					size="icon-sm"
					href="/compare?a={b.id}&b={a.id}"
					aria-label={i18n.t.compare.flip}
					title={i18n.t.compare.flip}
				>
					<ArrowLeftRightIcon />
				</Button>
			{/if}
			<a
				class="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm shadow-xs hover:border-primary/50"
				href="/takes/{take.id}"
				data-side={side}
			>
				<span
					class="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground"
				>
					{name}
				</span>
				<VoiceMark intent={take.intent} />
				{#if a.person_id !== b.person_id || take.person_id !== app.me?.id}
					<span
						class="flex shrink-0 items-center gap-1 font-bold text-primary"
						data-testid="compare-person"
					>
						<PersonMark shape={shapeOf(app.people, take.person_id)} />
						{app.person(take.person_id)?.name}
					</span>
				{/if}
				<span class="truncate">
					<span class="font-bold">{title(take)}</span>
					<span class="text-muted-foreground">
						· {i18n.t.intent[take.intent]} · {fmtDateTime(take.recorded_at, i18n.locale)}
					</span>
				</span>
			</a>
		{/each}
	</div>

	<div class="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
		<div class="min-w-0 space-y-4">
			{#if traces[0] || traces[1]}
				<section class="panel space-y-2" data-testid="compare-overlay" data-shift={shift}>
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-base">{i18n.t.compare.moment}</h2>
						<Help title={i18n.t.compare.moment} text={i18n.t.compare.momentHelp} />
						<div class="ms-auto flex flex-wrap items-center gap-1.5 text-sm">
							<Button
								size="sm"
								onclick={swap}
								title={i18n.t.compare.swapHint}
								data-testid="compare-swap"
							>
								<ArrowLeftRightIcon />
								{i18n.t.compare.swap(last === 'a' ? 'B' : 'A')}
							</Button>
							<Button variant="outline" size="sm" onclick={align} data-testid="compare-align">
								{i18n.t.compare.align}
							</Button>
							<div
								class="flex items-center rounded-lg border"
								role="group"
								aria-label={i18n.t.compare.moved}
							>
								<button
									type="button"
									class="px-2 py-1 text-muted-foreground hover:text-foreground"
									aria-label={i18n.t.compare.earlier}
									onclick={() => (shift = Math.round((shift - NUDGE_S) * 100) / 100)}
								>
									−
								</button>
								<span class="min-w-20 text-center text-xs tabular-nums" data-testid="compare-shift">
									B {fmtSigned(shift, 1, i18n.locale)} s
								</span>
								<button
									type="button"
									class="px-2 py-1 text-muted-foreground hover:text-foreground"
									aria-label={i18n.t.compare.later}
									onclick={() => (shift = Math.round((shift + NUDGE_S) * 100) / 100)}
								>
									+
								</button>
							</div>
							{#if shift !== 0}
								<Button variant="ghost" size="sm" onclick={() => (shift = 0)}>
									{i18n.t.compare.together}
								</Button>
							{/if}
						</div>
					</div>
					<CompareTraces
						a={traces[0]}
						b={traces[1]}
						voices={[a.intent, b.intent]}
						{shift}
						{position}
						onseek={seek}
					/>
					{#if traced && (!traces[0] || !traces[1])}
						<p class="text-sm text-muted-foreground" data-testid="compare-no-graph">
							{i18n.t.compare.noGraph(traces[0] ? 'B' : 'A')}
						</p>
					{/if}
				</section>
			{:else if traced}
				<p class="panel text-sm text-muted-foreground" data-testid="compare-no-graph">
					{i18n.t.compare.noGraphs}
				</p>
			{/if}

			<div class="grid gap-4 md:grid-cols-2">
				{#each sides as { side, name, take } (side)}
					<section
						class={['panel', last === side && (sounding.a || sounding.b) && 'border-primary/60']}
						data-player={side}
					>
						<p class="mb-2 flex items-center gap-2 text-sm">
							<span
								class="grid size-6 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground"
							>
								{name}
							</span>
							<span class="truncate text-muted-foreground">
								{fmtDateTime(take.recorded_at, i18n.locale)} · {take.device_name}
							</span>
						</p>
						<TakePlayer
							bind:this={players[side]}
							bind:position={positions[side]}
							bind:sounding={sounding[side]}
							source={takeAudioUrl(take.id)}
							name="{take.id}.flac"
						/>
					</section>
				{/each}
			</div>
		</div>

		<section class="panel overflow-x-auto" data-testid="comparison">
			<table class="w-full text-sm tabular-nums">
				<thead class="text-left text-xs text-muted-foreground">
					<tr>
						<th class="py-1 pr-3 font-medium">{i18n.t.compare.metric}</th>
						<th class="py-1 pr-3 text-right font-medium">A</th>
						<th class="py-1 pr-3 text-right font-medium">B</th>
						<th class="py-1 text-right font-medium">{i18n.t.compare.difference}</th>
					</tr>
				</thead>
				<tbody>
					{#each groups as { group, metrics } (group)}
						<tr>
							<th colspan="4" class="pt-3 pb-1 text-left text-base font-extrabold">
								{i18n.t.groups[group]}
							</th>
						</tr>
						{#each metrics as metric (metric.key)}
							<tr class="border-t" data-metric={metric.key}>
								<td class="py-1 pr-3">{i18n.pick(metric.titles) || metric.key}</td>
								<td class="py-1 pr-3 text-right">
									{fmtMetric(a.metrics[metric.key], metric, i18n.locale)}
								</td>
								<td class="py-1 pr-3 text-right">
									{fmtMetric(b.metrics[metric.key], metric, i18n.locale)}
								</td>
								<td class="py-1 text-right font-bold">
									{delta(
										b.metrics[metric.key] - a.metrics[metric.key],
										metric.decimals,
										metric.unit
									)}
								</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</section>
	</div>
{/if}
