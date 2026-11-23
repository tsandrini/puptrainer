<script lang="ts" module>
	/** One line of a plot. */
	export type PlotSeries = {
		key: string;
		label: string;
		/** A colour, or a theme variable such as `var(--series-1)`. */
		color: string;
		/** One value per `x`; `null` where there is nothing. */
		values: (number | null)[];
		/** A fainter line: a reference beside the main ones. */
		faint?: boolean;
		/** Dashes and gaps in pixels: the line of the everyday voice, or of a drill. */
		dash?: number[];
		/** What the legend says for a value. */
		format: (value: number, index: number) => string;
		/** What the legend says where there is no value; a dash without it. */
		blank?: (index: number) => string | null;
	};
	/** A stretch of the x axis that is shaded: a sound (`sound`), or something left out (`mute`). */
	export type PlotSpan = { from: number; to: number; tone: 'sound' | 'mute' };
	/** A stretch of the value axis that is shaded: a band or a zone. */
	export type PlotZone = { low: number; high: number };
</script>

<script lang="ts">
	// Several lines on one grid with one value axis along a take: the app's
	// chart for a signal over time (statistics over takes are `Chart`). Drawn
	// by uPlot on a canvas; the legend under it is text and says each line's
	// value at the pointer, or at the position marked from outside (a
	// player's playhead). Plots that share a `sync` key share the pointer,
	// and only the one under it reports what is hovered; a drag zooms and a
	// double click zooms back out when `zoomable`, for every plot bound to
	// the same `shown`; a click reports where it was.
	import { untrack } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { stepDecimals } from '#lib/charts.js';
	import { theme } from '#lib/theme.svelte.js';

	let {
		x,
		series,
		label,
		tick,
		tickX,
		height = 150,
		range,
		include = [],
		zero = false,
		cursor = null,
		sync,
		spans = [],
		zones = [],
		zoomable = false,
		axis = true,
		shown = $bindable(null),
		onpick,
		onhover
	}: {
		/** Where each value sits, in seconds of the take. */
		x: number[];
		series: PlotSeries[];
		/** What the plot shows, for assistive technology. */
		label: string;
		/** A tick of the value axis as text, with the decimals its steps need. */
		tick: (value: number, decimals: number) => string;
		/** A tick of the x axis as text; `step` is what lies between two ticks. */
		tickX: (value: number, step: number) => string;
		height?: number;
		/** The ends of the value axis; without them it follows the values. */
		range?: readonly [number, number];
		/** Values the axis covers whatever the lines do, when it follows the values. */
		include?: number[];
		/** Draw the zero of the value axis as a line of its own. */
		zero?: boolean;
		/** A position on the x axis marked from outside, e.g. where a player stands. */
		cursor?: number | null;
		/** Plots with the same key show the pointer of each other. */
		sync?: string;
		spans?: PlotSpan[];
		zones?: PlotZone[];
		/** A drag across zooms into that stretch; a double click zooms out. */
		zoomable?: boolean;
		/** Label the x axis; off for a plot that has one of the same axis right under it. */
		axis?: boolean;
		/** The stretch of the x axis in view, `null` for all of it; plots can share it. */
		shown?: [number, number] | null;
		/** Called with the x value, and the nearest index, of a click. */
		onpick?: (x: number, index: number | null) => void;
		/** Called with the index under the pointer while it is on this plot, `null` when it leaves. */
		onhover?: (index: number | null) => void;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let hovered = $state<number | null>(null);
	/** The plotting area inside the host, in CSS pixels, and the x values at its ends. */
	let area = $state.raw<{ left: number; width: number; min: number; max: number } | null>(null);
	let plot: uPlot | null = null;
	let down: { x: number; y: number } | null = null;
	/** The stretch the plot was last put to; `null` while it finds its own ends. */
	let applied: [number, number] | null = null;
	/** The pointer is on this plot, not on one it is linked with. */
	let inside = false;
	/** The index last reported as hovered. */
	let told: number | null = null;
	const sized = $derived(width > 0);

	const shape = $derived(
		[
			series.map((s) => `${s.key}:${s.color}:${s.faint}:${s.dash?.join(' ') ?? ''}`).join('|'),
			axis,
			zoomable,
			sync ?? '',
			theme.dark
		].join(';')
	);

	/** The index whose x lies nearest to a value. */
	function nearest(value: number): number | null {
		if (!x.length) return null;
		let low = 0;
		let high = x.length - 1;
		while (high - low > 1) {
			const middle = (low + high) >> 1;
			if (x[middle] <= value) low = middle;
			else high = middle;
		}
		return Math.abs(x[low] - value) <= Math.abs(x[high] - value) ? low : high;
	}

	/** The index the legend reads: under the pointer, else at the outside cursor, else the last. */
	const at = $derived(
		hovered ?? (cursor !== null ? nearest(cursor) : x.length ? x.length - 1 : null)
	);

	const data = (): uPlot.AlignedData => [x, ...series.map((s) => s.values)] as uPlot.AlignedData;

	function measure(): void {
		if (!plot) return;
		const { min, max } = plot.scales.x;
		if (min == null || max == null) return;
		area = { left: plot.over.offsetLeft, width: plot.over.offsetWidth, min, max };
	}

	function build(element: HTMLDivElement, size: number): uPlot {
		const css = getComputedStyle(element);
		const token = (name: string) => css.getPropertyValue(name).trim();
		const colour = (value: string) =>
			value.startsWith('var(') ? token(value.slice(4, -1)) : value;
		const ink = token('--muted-foreground');
		const grid = token('--chart-grid');
		const font = `11px ${css.fontFamily}`;
		const lines = { stroke: ink, font, grid: { stroke: grid, width: 1 }, ticks: { show: false } };
		return new uPlot(
			{
				width: size,
				height,
				legend: { show: false },
				padding: [8, 10, 0, 0],
				cursor: {
					y: false,
					// NOTE: a drag only selects; the stretch goes through `shown` to every plot
					drag: { x: zoomable, y: false, setScale: false },
					// NOTE: no zoom-out of uPlot's own: its ends are not ours (see `ends`)
					bind: { dblclick: () => null },
					...(sync
						? {
								sync: {
									key: sync,
									// NOTE: linked plots share the pointer, not presses: uPlot would
									// repeat a zoom by pixels, which is another stretch on other data
									filters: {
										pub: (type: string) => type === 'mousemove' || type === 'mouseleave'
									}
								}
							}
						: {})
				},
				scales: {
					x: { time: false },
					y: {
						range: (_u, low, high) => {
							if (range) return [range[0], range[1]];
							const values = [low, high, ...include].filter((v) => Number.isFinite(v));
							if (!values.length) return [0, 1];
							const [from, to] = [Math.min(...values), Math.max(...values)];
							const pad = (to - from) * 0.12 || Math.abs(to) * 0.1 || 1;
							return [from - pad, to + pad];
						}
					}
				},
				axes: [
					{
						...lines,
						size: axis ? 26 : 6,
						values: (_u, splits, _axis, _space, step) =>
							splits.map((value) => (axis ? tickX(value, step) : ''))
					},
					{
						...lines,
						size: 48,
						values: (_u, splits, _axis, _space, step) =>
							splits.map((value) => tick(value, stepDecimals(step)))
					}
				],
				series: [
					{},
					...series.map((s) => ({
						label: s.label,
						stroke: colour(s.color),
						width: 2,
						alpha: s.faint ? 0.45 : 1,
						dash: s.dash,
						spanGaps: false,
						points: { show: false }
					}))
				],
				hooks: {
					drawClear: [
						(u) => {
							const { ctx, bbox } = u;
							ctx.save();
							ctx.beginPath();
							ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
							ctx.clip();
							ctx.fillStyle = token('--chart-band');
							for (const zone of zones) {
								const top = u.valToPos(zone.high, 'y', true);
								ctx.fillRect(bbox.left, top, bbox.width, u.valToPos(zone.low, 'y', true) - top);
							}
							for (const span of spans) {
								const from = u.valToPos(span.from, 'x', true);
								ctx.globalAlpha = span.tone === 'mute' ? 0.22 : 0.06;
								ctx.fillStyle = span.tone === 'mute' ? ink : token('--foreground');
								ctx.fillRect(from, bbox.top, u.valToPos(span.to, 'x', true) - from, bbox.height);
							}
							ctx.globalAlpha = 1;
							if (zero) {
								const y = Math.round(u.valToPos(0, 'y', true)) + 0.5;
								ctx.strokeStyle = token('--border');
								ctx.lineWidth = devicePixelRatio;
								ctx.beginPath();
								ctx.moveTo(bbox.left, y);
								ctx.lineTo(bbox.left + bbox.width, y);
								ctx.stroke();
							}
							ctx.restore();
						}
					],
					setCursor: [
						(u) => {
							const index =
								u.cursor.left != null && u.cursor.left >= 0 ? (u.cursor.idx ?? null) : null;
							if (index !== hovered) hovered = index;
							if (!inside || index === told) return;
							told = index;
							onhover?.(index);
						}
					],
					setSelect: [
						(u) => {
							const { left, width: wide } = u.select;
							if (wide <= 0) return;
							const stretch: [number, number] = [
								u.posToVal(left, 'x'),
								u.posToVal(left + wide, 'x')
							];
							u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
							// NOTE: a few pixels are a click that slipped, not a stretch
							if (zoomable && wide >= 4) shown = stretch;
						}
					],
					setScale: [(_u, key) => key === 'x' && measure()],
					ready: [measure],
					setSize: [measure]
				}
			},
			data(),
			element
		);
	}

	/** The ends of the x axis with everything in view. */
	function ends(): [number, number] | null {
		if (!x.length) return null;
		const [from, to] = [x[0], x[x.length - 1]];
		return to > from ? [from, to] : [from - 1, from + 1];
	}

	/** Put the plot to the stretch it was told, or to all of its values. */
	function frame(target: uPlot): void {
		const stretch = applied ?? ends();
		if (stretch) target.setScale('x', { min: stretch[0], max: stretch[1] });
	}

	// the plot is made anew when what it is made of changes (its lines, the theme),
	// not when its values do
	$effect(() => {
		void shape;
		const element = host;
		if (!element || !sized) return;
		const made = untrack(() => build(element, width));
		plot = made;
		inside = false;
		told = null;
		untrack(() => {
			applied = shown;
			frame(made);
		});
		const press = (event: MouseEvent) => (down = { x: event.clientX, y: event.clientY });
		const click = (event: MouseEvent) => {
			// NOTE: a drag (a zoom) ends in a click too; only a press in place is a pick
			const still = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4;
			if (!still || made.cursor.left == null || !onpick) return;
			onpick(made.posToVal(made.cursor.left, 'x'), made.cursor.idx ?? null);
		};
		const enter = () => (inside = true);
		const leave = () => {
			inside = false;
			if (told === null) return;
			told = null;
			onhover?.(null);
		};
		const reset = () => {
			if (zoomable && shown !== null) shown = null;
		};
		made.over.addEventListener('mousedown', press);
		made.over.addEventListener('click', click);
		made.over.addEventListener('mouseenter', enter);
		made.over.addEventListener('mouseleave', leave);
		made.over.addEventListener('dblclick', reset);
		return () => {
			made.destroy();
			if (plot === made) plot = null;
		};
	});

	// new values, the same lines
	$effect(() => {
		const next = data();
		void zones;
		void spans;
		void range;
		if (!plot) return;
		// NOTE: a zoomed plot keeps its stretch when values arrive
		plot.setData(next, !x.length);
		frame(plot);
		measure();
	});

	// a stretch chosen in another plot, or reset there
	$effect(() => {
		const stretch = shown;
		const target = plot;
		if (!target) return;
		untrack(() => {
			applied = stretch;
			frame(target);
		});
	});

	$effect(() => {
		if (!plot || !width) return;
		plot.setSize({ width, height });
	});

	$effect(() => {
		if (!host) return;
		const observer = new ResizeObserver(([entry]) => (width = Math.floor(entry.contentRect.width)));
		observer.observe(host);
		return () => observer.disconnect();
	});

	const mark = $derived(
		cursor !== null && area && cursor >= area.min && cursor <= area.max
			? area.left + ((cursor - area.min) / (area.max - area.min)) * area.width
			: null
	);
</script>

<div
	class="min-w-0"
	data-testid="plot"
	data-series={series.map((s) => s.key).join(' ')}
	data-zoomed={shown !== null}
>
	<div
		bind:this={host}
		class="relative w-full"
		style:height="{height}px"
		role="img"
		aria-label={label}
	>
		{#if mark !== null}
			<div
				class={[
					'pointer-events-none absolute top-2 z-10 w-0.5 -translate-x-1/2 bg-foreground/80',
					axis ? 'bottom-6.5' : 'bottom-1.5'
				]}
				style="left: {mark}px"
				data-testid="plot-cursor"
			></div>
		{/if}
	</div>
	<ul class="flex flex-wrap gap-x-4 gap-y-0.5 pl-12 text-xs" data-testid="plot-legend">
		{#each series as s (s.key)}
			{@const value = at !== null ? s.values[at] : null}
			<li class="flex items-baseline gap-1.5" data-series={s.key}>
				<!-- NOTE: the swatch is the line: dashed where the line is -->
				<span
					class="inline-block h-0 w-5 translate-y-[-3px] border-t-2"
					style="border-color: {s.color}; border-top-style: {s.dash
						? 'dashed'
						: 'solid'}; opacity: {s.faint ? 0.45 : 1}"
				></span>
				<span class="text-muted-foreground">{s.label}</span>
				<span class="font-semibold tabular-nums" data-testid="plot-value">
					{value == null ? (at !== null && s.blank?.(at)) || '–' : s.format(value, at ?? 0)}
				</span>
			</li>
		{/each}
	</ul>
</div>
