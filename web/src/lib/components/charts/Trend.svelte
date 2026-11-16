<script lang="ts">
	// One measurement over time: a point per take, joined by a line per
	// voice (everyday, attempt). The last point of the first series is
	// labelled; the crosshair names the take under the pointer.
	import { Axis, Chart, Circle, Highlight, Spline, Svg, Text, Tooltip } from 'layerchart';
	import { niceTicks, timeTicks } from '#lib/charts.js';
	import Tip from './Tip.svelte';

	export type TrendPoint = { ts: number; value: number; label: string };
	export type TrendSeries = { key: string; label: string; color: string; points: TrendPoint[] };

	let {
		series,
		fmt,
		fmtTime,
		height = 170
	}: {
		series: TrendSeries[];
		fmt: (value: number) => string;
		fmtTime: (ts: number) => string;
		height?: number;
	} = $props();

	const PAD = { top: 10, right: 56, bottom: 24, left: 48 };

	const all = $derived(series.flatMap((s) => s.points));
	const yTicks = $derived(
		niceTicks(Math.min(...all.map((p) => p.value)), Math.max(...all.map((p) => p.value)), 3)
	);
	/** The time axis has room on both sides, also when every take is from one hour. */
	const span = $derived.by(() => {
		const from = Math.min(...all.map((p) => p.ts));
		const to = Math.max(...all.map((p) => p.ts));
		const pad = Math.max((to - from) * 0.06, 30 * 60_000);
		return [from - pad, to + pad] as [number, number];
	});
	/** One label when every take is from the same day or two, three once they spread out. */
	const xTicks = $derived(
		span[1] - span[0] < 36 * 3_600_000 ? [(span[0] + span[1]) / 2] : timeTicks(span[0], span[1], 3)
	);
	const rows = $derived(
		[...new Set(all.map((p) => p.ts))].sort((a, b) => a - b).map((ts) => ({ ts }))
	);
	const last = $derived(series[0]?.points.at(-1) ?? null);
</script>

<div style:height="{height}px" class="text-xs" data-testid="trend">
	<Chart
		data={rows}
		x="ts"
		xDomain={span}
		y={() => yTicks[0]}
		yDomain={[yTicks[0], yTicks[yTicks.length - 1]]}
		padding={PAD}
		tooltipContext={{ mode: 'bisect-x' }}
	>
		{#snippet children({ context })}
			{@const x = (t: number) => context.xScale(t) as number}
			{@const y = (v: number) => context.yScale(v) as number}
			<Svg>
				<Axis
					placement="left"
					ticks={yTicks}
					format={fmt}
					grid={{ class: 'stroke-chart-grid' }}
					tickMarks={false}
					rule={false}
				/>
				<Axis placement="bottom" ticks={xTicks} format={fmtTime} tickMarks={false} rule={false} />
				{#each series as s (s.key)}
					{#if s.points.length > 1}
						<Spline
							data={s.points}
							x="ts"
							y="value"
							stroke={s.color}
							strokeWidth={2}
							class="[stroke-linecap:round] [stroke-linejoin:round]"
						/>
					{/if}
					{#each s.points as p (p.ts)}
						<Circle
							cx={x(p.ts)}
							cy={y(p.value)}
							r={4}
							fill={s.color}
							class="stroke-card"
							strokeWidth={2}
						/>
					{/each}
				{/each}
				{#if last}
					<Text
						x={x(last.ts) + 9}
						y={y(last.value) + 4}
						value={fmt(last.value)}
						class="fill-foreground font-semibold"
					/>
				{/if}
				<Highlight axis="x" lines={{ class: 'stroke-border' }} />
			</Svg>
			<Tooltip.Root {context}>
				{#snippet children({ data: d })}
					{@const here = series.flatMap((s) =>
						s.points.filter((p) => p.ts === d.ts).map((p) => ({ s, p }))
					)}
					<Tip
						lines={[
							here
								.map(({ s, p }) => (series.length > 1 ? `${s.label}: ` : '') + fmt(p.value))
								.join(' · '),
							here[0]?.p.label,
							fmtTime(d.ts)
						]}
					/>
				{/snippet}
			</Tooltip.Root>
		{/snippet}
	</Chart>
</div>
