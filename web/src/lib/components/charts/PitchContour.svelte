<script lang="ts">
	// The pitch of one take over its length: a single series, broken where
	// the voice is unvoiced, with the 145–185 Hz band shaded for reference.
	// A crosshair reads the pitch at the moment under the pointer.
	import { Axis, Chart, ChartClipPath, Highlight, Rect, Spline, Svg, Tooltip } from 'layerchart';
	import type { Series } from '#lib/api/types.js';
	import { niceTicks } from '#lib/charts.js';
	import { fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import Tip from './Tip.svelte';

	let { series, height = 200 }: { series: Series; height?: number } = $props();

	const BAND = [145, 185] as const;
	const PAD = { top: 8, right: 12, bottom: 24, left: 44 };
	type Point = { t: number; hz: number | null };

	const points = $derived<Point[]>(
		series.values.map((hz, i) => ({ t: series.start_s + i * series.step_s, hz }))
	);
	const voiced = $derived(
		points.flatMap((p) => (p.hz === null ? [] : [p.hz])).sort((a, b) => a - b)
	);
	/** The scale follows the voice, not its strays: the 1st to 99th percentile, padded. */
	const yTicks = $derived.by(() => {
		if (!voiced.length) return [100, 200];
		const low = voiced[Math.floor(0.01 * (voiced.length - 1))];
		const high = voiced[Math.ceil(0.99 * (voiced.length - 1))];
		return niceTicks(Math.min(low, BAND[0]) * 0.95, Math.max(high, BAND[1]) * 1.05, 4);
	});
	const end = $derived(series.start_s + series.values.length * series.step_s);
	const xTicks = $derived(niceTicks(0, end, 6).filter((t) => t <= end));
	const seconds = (t: number) => `${fmtNumber(t, t < 10 ? 1 : 0, i18n.locale)} s`;
</script>

<div style:height="{height}px" class="text-xs" data-testid="contour">
	<Chart
		data={points}
		x="t"
		xDomain={[0, end]}
		y="hz"
		yDomain={[yTicks[0], yTicks[yTicks.length - 1]]}
		padding={PAD}
		tooltipContext={{ mode: 'bisect-x' }}
	>
		{#snippet children({ context })}
			{@const y = (v: number) => context.yScale(v) as number}
			<Svg>
				<Rect
					x={0}
					y={y(BAND[1])}
					width={context.width}
					height={y(BAND[0]) - y(BAND[1])}
					class="fill-chart-band"
				/>
				<Axis
					placement="left"
					ticks={yTicks}
					format={(v: number) => `${v}`}
					grid={{ class: 'stroke-chart-grid' }}
					tickMarks={false}
					rule={false}
				/>
				<Axis placement="bottom" ticks={xTicks} format={seconds} tickMarks={false} rule={false} />
				<!-- NOTE: stray frames far outside the scale are cut off at its edge -->
				<ChartClipPath>
					<Spline
						data={points}
						x="t"
						y="hz"
						defined={(d: Point) => d.hz !== null}
						stroke="var(--series-1)"
						strokeWidth={2}
						class="[stroke-linecap:round] [stroke-linejoin:round]"
					/>
				</ChartClipPath>
				<Highlight axis="x" lines={{ class: 'stroke-border' }} />
			</Svg>
			<Tooltip.Root {context}>
				{#snippet children({ data: d })}
					<Tip
						lines={[d.hz === null ? i18n.t.common.none : `${Math.round(d.hz)} Hz`, seconds(d.t)]}
					/>
				{/snippet}
			</Tooltip.Root>
		{/snippet}
	</Chart>
</div>
