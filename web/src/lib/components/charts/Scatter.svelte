<script lang="ts" module>
	/** One take on a scatter of two measures. */
	export type ScatterPoint = { id: string; x: number; y: number; color: string; hollow: boolean };
</script>

<script lang="ts">
	// Two measures against each other: one point per take, so that it shows
	// whether they go together (does a lighter voice come out brighter?). A
	// thin line is their least-squares fit. The pointer picks the nearest
	// point; a click reports it.
	import { niceTicks } from '#lib/charts.js';

	let {
		points,
		labelX,
		labelY,
		tick,
		height = 300,
		picked = null,
		onhover,
		onpick
	}: {
		points: ScatterPoint[];
		labelX: string;
		labelY: string;
		/** A tick of either axis as text, with the decimals its steps need. */
		tick: (value: number, decimals: number) => string;
		height?: number;
		/** The id of a point to mark from outside. */
		picked?: string | null;
		onhover?: (id: string | null) => void;
		onpick?: (id: string) => void;
	} = $props();

	const PAD = { top: 10, right: 14, bottom: 40, left: 58 };
	/** How near the pointer has to be to a point to mean it, in pixels. */
	const REACH = 28;

	let host = $state<HTMLDivElement | null>(null);
	let width = $state(0);

	const ticks = (values: number[]) => {
		if (!values.length) return [0, 1];
		const [low, high] = [Math.min(...values), Math.max(...values)];
		const pad = (high - low) * 0.08 || Math.abs(high) * 0.1 || 1;
		return niceTicks(low - pad, high + pad, 5);
	};
	const xs = $derived(ticks(points.map((p) => p.x)));
	const ys = $derived(ticks(points.map((p) => p.y)));
	/** The decimals that tell the ticks of an axis apart. */
	const decimals = (axis: number[]) => {
		const step = Math.abs(axis[1] - axis[0]);
		return step >= 1 && Number.isInteger(step) ? 0 : step >= 0.1 ? 1 : 2;
	};
	const px = (value: number) =>
		PAD.left + ((value - xs[0]) / (xs[xs.length - 1] - xs[0])) * (width - PAD.left - PAD.right);
	const py = (value: number) =>
		height -
		PAD.bottom -
		((value - ys[0]) / (ys[ys.length - 1] - ys[0])) * (height - PAD.top - PAD.bottom);

	/** The least-squares line through the points, as its two ends; null with fewer than three. */
	const fit = $derived.by(() => {
		const n = points.length;
		if (n < 3) return null;
		const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
		const my = points.reduce((sum, p) => sum + p.y, 0) / n;
		const sxx = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
		if (!sxx) return null;
		const slope = points.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0) / sxx;
		const at = (value: number) => my + slope * (value - mx);
		const [from, to] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
		return { x1: from, y1: at(from), x2: to, y2: at(to) };
	});

	function near(event: PointerEvent): string | null {
		const box = host!.getBoundingClientRect();
		const [mx, my] = [event.clientX - box.left, event.clientY - box.top];
		let best: string | null = null;
		let reach = REACH;
		for (const point of points) {
			const distance = Math.hypot(px(point.x) - mx, py(point.y) - my);
			if (distance < reach) [best, reach] = [point.id, distance];
		}
		return best;
	}

	$effect(() => {
		if (!host) return;
		const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
		observer.observe(host);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={host}
	class="relative w-full touch-none select-none"
	style:height="{height}px"
	role="img"
	aria-label="{labelY} / {labelX}"
	onpointermove={(event) => onhover?.(near(event))}
	onpointerleave={() => onhover?.(null)}
	onpointerup={(event) => {
		// NOTE: pointer only; every take is also reachable from the list of takes
		const id = near(event);
		if (id) onpick?.(id);
	}}
	data-testid="scatter"
	data-points={points.length}
>
	{#if width}
		<svg {width} {height} class="block text-[11px]">
			{#each ys as value (value)}
				<line
					x1={PAD.left}
					x2={width - PAD.right}
					y1={py(value)}
					y2={py(value)}
					class={value === 0 ? 'stroke-border' : 'stroke-chart-grid'}
				/>
				<text x={PAD.left - 6} y={py(value) + 4} text-anchor="end" class="fill-muted-foreground">
					{tick(value, decimals(ys))}
				</text>
			{/each}
			{#each xs as value (value)}
				<line
					x1={px(value)}
					x2={px(value)}
					y1={PAD.top}
					y2={height - PAD.bottom}
					class={value === 0 ? 'stroke-border' : 'stroke-chart-grid'}
				/>
				<text
					x={px(value)}
					y={height - PAD.bottom + 15}
					text-anchor="middle"
					class="fill-muted-foreground"
				>
					{tick(value, decimals(xs))}
				</text>
			{/each}
			<text
				x={(PAD.left + width - PAD.right) / 2}
				y={height - 6}
				text-anchor="middle"
				class="fill-foreground font-semibold"
			>
				{labelX}
			</text>
			<text
				transform="translate(13 {(PAD.top + height - PAD.bottom) / 2}) rotate(-90)"
				text-anchor="middle"
				class="fill-foreground font-semibold"
			>
				{labelY}
			</text>
			{#if fit}
				<line
					x1={px(fit.x1)}
					y1={py(fit.y1)}
					x2={px(fit.x2)}
					y2={py(fit.y2)}
					class="stroke-muted-foreground/60"
					stroke-dasharray="4 4"
				/>
			{/if}
			{#each points as point (point.id)}
				<circle
					cx={px(point.x)}
					cy={py(point.y)}
					r={point.id === picked ? 7 : 5}
					fill={point.hollow ? 'var(--card)' : point.color}
					stroke={point.color}
					stroke-width="2"
					data-point={point.id}
				/>
			{/each}
		</svg>
	{/if}
</div>
