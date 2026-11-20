<script lang="ts">
	// A take's measurements, grouped (recording, pitch, resonance, voice
	// quality, range). Each group says how it stands to the two targets, each
	// measurement what it measures, how far to trust it, and what it says
	// about pitch or resonance.
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let { take }: { take: TakeOut } = $props();

	/** The groups with a value in this take; a note shared by neighbours is shown once, on the last. */
	const groups = $derived(
		app
			.groups(take.item)
			.map((g) => {
				const metrics = g.metrics.filter((m) => take.metrics[m.key] !== undefined);
				return {
					group: g.group,
					rows: metrics.map((metric, index) => {
						const note = i18n.pick(metric.notes);
						const relates = i18n.pick(metric.relates);
						const next = metrics[index + 1];
						return {
							metric,
							note: next && i18n.pick(next.notes) === note ? '' : note,
							relates: next && i18n.pick(next.relates) === relates ? '' : relates
						};
					})
				};
			})
			.filter((g) => g.rows.length)
	);
</script>

<div class="grid items-start gap-4 md:grid-cols-2" data-testid="metrics">
	{#each groups as { group, rows } (group)}
		<section class="panel" data-group={group}>
			<h2 class="text-base">{i18n.t.groups[group]}</h2>
			<p class="mb-1 text-xs text-muted-foreground" data-testid="group-intro">
				{i18n.t.groupIntro[group]}
			</p>
			<dl class="divide-y text-sm">
				{#each rows as { metric, note, relates } (metric.key)}
					<div class="py-2">
						<div class="flex justify-between gap-4">
							<dt class="font-semibold">{i18n.pick(metric.titles) || metric.key}</dt>
							<dd class="font-extrabold tabular-nums" data-metric={metric.key}>
								{fmtMetric(take.metrics[metric.key], metric, i18n.locale)}
							</dd>
						</div>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{i18n.pick(metric.descriptions)}
							{#if note}<span class="text-foreground/70">{note}</span>{/if}
						</p>
						{#if relates}
							<p class="mt-0.5 text-xs text-primary" data-testid="relates">{relates}</p>
						{/if}
					</div>
				{/each}
			</dl>
		</section>
	{/each}
</div>
