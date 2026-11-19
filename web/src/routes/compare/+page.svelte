<script lang="ts">
	// Two takes side by side: both players, and every measurement they
	// share with the difference between them.
	import { page } from '$app/state';
	import { fetchTake, takeAudioUrl } from '#lib/api/index.js';
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import TakePlayer from '#lib/components/audio/TakePlayer.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDateTime, fmtMetric, fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	const ids = $derived([page.url.searchParams.get('a'), page.url.searchParams.get('b')]);
	let pair = $state.raw<[TakeOut, TakeOut] | null>(null);
	let failed = $state(false);

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
		i18n.t.item[take.item] + (take.language ? `, ${i18n.language(take.language)}` : '');

	/** A difference with its sign: `+3 Hz`, `−0.4 cm`. */
	function delta(value: number, decimals: number, unit: string): string {
		const text = fmtNumber(Math.abs(value), decimals, i18n.locale);
		const zero = Number(text.replace(',', '.')) === 0;
		return `${zero ? '±' : value > 0 ? '+' : '−'}${text}${unit ? ` ${unit}` : ''}`;
	}

	$effect(() => {
		const [a, b] = ids;
		pair = null;
		failed = false;
		if (!a || !b) return;
		void Promise.all([fetchTake(a), fetchTake(b)])
			.then((both) => (pair = both))
			.catch(() => (failed = true));
	});
</script>

<div class="mb-4 flex items-center gap-2">
	<h1 class="mr-auto text-2xl">{i18n.t.compare.title}</h1>
	<Button href="/" variant="outline" size="sm">{i18n.t.compare.back}</Button>
</div>

{#if !ids[0] || !ids[1] || failed}
	<Empty text={i18n.t.compare.pick} />
{:else if pair === null}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else}
	{@const [a, b] = pair}
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

	<div class="grid gap-4 md:grid-cols-2">
		{#each [{ name: 'A', take: a }, { name: 'B', take: b }] as side (side.name)}
			<section class="panel">
				<div class="mb-2 flex items-baseline gap-2">
					<span
						class="grid size-7 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground"
					>
						{side.name}
					</span>
					<a class="font-bold underline-offset-4 hover:underline" href="/takes/{side.take.id}">
						{title(side.take)}
					</a>
				</div>
				<p class="mb-2 text-xs text-muted-foreground">
					{fmtDateTime(side.take.recorded_at, i18n.locale)} · {i18n.t.intent[side.take.intent]} ·
					{side.take.device_name}
				</p>
				<TakePlayer source={takeAudioUrl(side.take.id)} name="{side.take.id}.flac" />
			</section>
		{/each}
	</div>

	<section class="panel mt-4 overflow-x-auto" data-testid="comparison">
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
							<td class="py-1.5 pr-3">{i18n.pick(metric.titles) || metric.key}</td>
							<td class="py-1.5 pr-3 text-right">
								{fmtMetric(a.metrics[metric.key], metric, i18n.locale)}
							</td>
							<td class="py-1.5 pr-3 text-right">
								{fmtMetric(b.metrics[metric.key], metric, i18n.locale)}
							</td>
							<td class="py-1.5 text-right font-bold">
								{delta(b.metrics[metric.key] - a.metrics[metric.key], metric.decimals, metric.unit)}
							</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</section>
{/if}
