<script lang="ts">
	// A take's measurements, grouped (recording, pitch, resonance, voice
	// quality, range): a name and a number per line. How a group stands to
	// the two targets, and what a measurement measures, how far to trust it
	// and what it says about pitch or resonance, are behind the help buttons.
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { fmtMetric } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import Help from './Help.svelte';

	let { take }: { take: TakeOut } = $props();

	/** The groups with a value in this take. */
	const groups = $derived(
		app
			.groups(take.item)
			.map((g) => ({
				group: g.group,
				metrics: g.metrics.filter((m) => take.metrics[m.key] !== undefined)
			}))
			.filter((g) => g.metrics.length)
	);
</script>

<!-- NOTE: two columns where the place it is put in has the room, whatever the screen is -->
<div class="@container" data-testid="metrics">
	<div class="grid items-start gap-4 @2xl:grid-cols-2">
		{#each groups as { group, metrics } (group)}
			<section class="panel" data-group={group}>
				<h2 class="mb-1 flex items-center gap-1 text-base">
					{i18n.t.groups[group]}
					<Help title={i18n.t.groups[group]} text={i18n.t.groupIntro[group]} />
				</h2>
				<dl class="divide-y text-sm">
					{#each metrics as metric (metric.key)}
						<div class="flex items-center justify-between gap-3 py-1">
							<dt class="flex min-w-0 items-center gap-1">
								<span class="truncate">{i18n.pick(metric.titles) || metric.key}</span>
								<Help
									title={i18n.pick(metric.titles) || metric.key}
									text={[
										i18n.pick(metric.descriptions),
										i18n.pick(metric.notes),
										i18n.pick(metric.relates)
									]}
								/>
							</dt>
							<dd class="font-extrabold whitespace-nowrap tabular-nums" data-metric={metric.key}>
								{fmtMetric(take.metrics[metric.key], metric, i18n.locale)}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</div>
