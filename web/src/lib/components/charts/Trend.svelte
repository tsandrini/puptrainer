<script lang="ts">
	// One measurement over time: a point per take, joined by a line per
	// voice (everyday, attempt). The last point of the first series is
	// labelled; the crosshair names the take under the pointer. A distance
	// from the everyday voice can carry the zones it is read by.
	import { Axis, Chart, Circle, Highlight, Rect, Spline, Svg, Text, Tooltip } from 'layerchart';
	import { niceTicks, timeTicks } from '#lib/charts.js';
	import Tip from './Tip.svelte';

	export type TrendPoint = { ts: number; value: number; label: string };
	export type TrendSeries = { key: string; label: string; color: string; points: TrendPoint[] };
	/** A stretch of the value axis that is shaded; an unset end runs to the edge. */
	export type TrendZone = { key: string; low: number | null; high: number | null };

	let {
		series,
		fmt,
		fmtTime,
		height = 170,
		zones = [],
		include = []
	}: {
		series: TrendSeries[];
		fmt: (value: number) => string;
		fmtTime: (ts: number) => string;
		height?: number;
		zones?: TrendZone[];
		/** Values the scale reaches whatever the points are, e.g. zero and a zone's edge. */
		include?: number[];
	} = $props();

	const ZONE: Record<string, string> = { typical: 'fill-good/15', beyond: 'fill-warning/15' };

	const PAD = { top: 10, right: 56, bottom: 24, left: 48 };

	const all = $derived(series.flatMap((s) => s.points));
	const values = $derived([...all.map((p) => p.value), ...include]);
	const yTicks = $derived(niceTicks(Math.min(...values), Math.max(...values), 3));
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
				{#each zones as zone (zone.key)}
					{@const top = Math.min(zone.high ?? Infinity, yTicks[yTicks.length - 1])}
					{@const bottom = Math.max(zone.low ?? -Infinity, yTicks[0])}
					{#if top > bottom}
						<Rect
							x={0}
							y={y(top)}
							width={context.width}
							height={y(bottom) - y(top)}
							class={ZONE[zone.key] ?? 'fill-chart-band'}
							data-zone={zone.key}
						/>
					{/if}
				{/each}
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
