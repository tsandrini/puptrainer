<script lang="ts">
	// One number that matters, with where it comes from: the latest value
	// large, how it moved against the one before, the values of the stretch
	// as a small line, and a few words under it. No axis, no grid: the chart
	// of the same measure is below.
	import type { Snippet } from 'svelte';

	let {
		title,
		value,
		unit = '',
		delta,
		note,
		trail = [],
		color = 'var(--series-1)',
		zone,
		children
	}: {
		title: string;
		/** The headline, formatted; a dash when there is none. */
		value: string;
		unit?: string;
		/** The change against the value before: its size, which way, and what it is against. */
		delta?: { text: string; up: boolean; title: string } | null;
		/** A few words under the line: the middle of the stretch, how many takes. */
		note?: string;
		/** The values of the stretch in order, for the small line. */
		trail?: number[];
		color?: string;
		/** A reference range the line is drawn against, in the values' unit. */
		zone?: { low: number; high: number } | null;
		/** The help button, beside the title. */
		children?: Snippet;
	} = $props();

	const [WIDTH, HEIGHT] = [200, 30];
	const frame = $derived.by(() => {
		if (!trail.length) return null;
		const [low, high] = [Math.min(...trail, 0), Math.max(...trail, 0, zone ? zone.low * 1.15 : 0)];
		const span = high - low || 1;
		const y = (v: number) => HEIGHT - 3 - ((v - low) / span) * (HEIGHT - 6);
		const x = (i: number) =>
			trail.length > 1 ? (i / (trail.length - 1)) * (WIDTH - 8) + 4 : WIDTH / 2;
		return { x, y, high };
	});
</script>

<div class="panel flex min-w-0 flex-col gap-1.5 p-3" data-testid="stat-tile">
	<div class="flex items-center gap-1 text-xs font-bold text-muted-foreground">
		<span class="inline-block size-2 shrink-0 rounded-full" style:background={color}></span>
		<span class="truncate">{title}</span>
		{@render children?.()}
	</div>
	<div class="flex items-baseline justify-between gap-2 whitespace-nowrap">
		<p class="text-2xl leading-none font-black tabular-nums" data-testid="stat-value">
			{value}<span class="ps-1 text-sm font-bold text-muted-foreground">{unit}</span>
		</p>
		{#if delta}
			<p class="text-xs font-bold text-muted-foreground tabular-nums" title={delta.title}>
				{delta.up ? '▲' : '▼'}
				{delta.text}
			</p>
		{/if}
	</div>
	{#if frame}
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			preserveAspectRatio="none"
			class="h-7 w-full"
			aria-hidden="true"
		>
			{#if zone}
				<rect
					x="0"
					width={WIDTH}
					y={frame.y(Math.min(zone.high, frame.high))}
					height={Math.max(frame.y(zone.low) - frame.y(Math.min(zone.high, frame.high)), 0)}
					class="fill-good/15"
				/>
			{/if}
			<line
				x1="0"
				x2={WIDTH}
				y1={frame.y(0)}
				y2={frame.y(0)}
				class="stroke-border"
				vector-effect="non-scaling-stroke"
			/>
			{#if trail.length > 1}
				<polyline
					points={trail
						.map((v, i) => `${frame.x(i).toFixed(1)},${frame.y(v).toFixed(1)}`)
						.join(' ')}
					fill="none"
					stroke={color}
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
		</svg>
	{:else}
		<div class="h-7"></div>
	{/if}
	{#if note}<p class="truncate text-xs text-muted-foreground" title={note}>{note}</p>{/if}
</div>
