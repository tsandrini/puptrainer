<script lang="ts">
	// One ECharts chart: it takes an option (see `#lib/progress/options.ts`),
	// follows its box, keeps its zoom while the data under it changes, and
	// reports a click on a datum and a rectangle selection. `fill` takes the
	// height of its parent (the whole-screen view).
	import type { EChartsOption } from 'echarts';
	import { untrack } from 'svelte';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';
	import { echarts, type Instance } from './echarts.js';

	type Picked = { data?: unknown; seriesId?: string; seriesIndex?: number; dataIndex?: number };

	let {
		option,
		height = 260,
		group,
		label,
		onpick,
		onselect,
		class: className
	}: {
		option: EChartsOption;
		/** Pixels, or `fill` for all of the parent's height. */
		height?: number | 'fill';
		/** Charts of one group share the pointer and the zoom. */
		group?: string;
		/** What the chart shows, for assistive technology. */
		label: string;
		/** A click on a datum. */
		onpick?: (picked: Picked) => void;
		/** The `take` of every datum inside a selection rectangle; none when it is cleared. */
		onselect?: (takes: string[]) => void;
		class?: string;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let chart = $state.raw<Instance | null>(null);
	let drawn = '';

	const list = (value: unknown): unknown[] =>
		Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	/** What a chart is made of: when it changes, the chart starts afresh instead of merging. */
	const shapeOf = (o: EChartsOption): string =>
		[
			list(o.grid).length,
			list(o.xAxis).length,
			list(o.dataZoom).length,
			o.legend ? 1 : 0,
			o.brush ? 1 : 0,
			list(o.series)
				.map((s) => (s as { id?: string; name?: string; type?: string }).id ?? '')
				.join('|')
		].join(';');

	/** The chart as a PNG data URL, on a background (a canvas is transparent). */
	export function image(background: string): string | null {
		return chart?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: background }) ?? null;
	}

	$effect(() => {
		const element = host;
		const locale = i18n.locale === 'cs' ? 'CS' : 'EN';
		if (!element) return;
		const made = echarts.init(element, null, { renderer: 'canvas', locale });
		if (group) {
			made.group = group;
			echarts.connect(group);
		}
		made.on('click', (event) => untrack(() => onpick)?.(event as Picked));
		made.on('brushselected', (event) => {
			const batch = (
				event as { batch?: { selected: { seriesIndex: number; dataIndex: number[] }[] }[] }
			).batch;
			const all = list(made.getOption().series) as { data?: { take?: string }[] }[];
			const takes = (batch?.[0]?.selected ?? []).flatMap((part) =>
				part.dataIndex.flatMap((index) => all[part.seriesIndex]?.data?.[index]?.take ?? [])
			);
			untrack(() => onselect)?.(takes);
		});
		// NOTE: the instance on its element: for the browser tests and for a look from the console
		(element as HTMLDivElement & { chart?: Instance }).chart = made;
		const observer = new ResizeObserver(() => made.resize());
		observer.observe(element);
		drawn = '';
		chart = made;
		return () => {
			observer.disconnect();
			made.dispose();
			chart = null;
		};
	});

	$effect(() => {
		const [target, next] = [chart, option];
		if (!target) return;
		const shape = shapeOf(next);
		// NOTE: merged, a chart keeps its zoom and its switched-off series; a new shape starts over
		if (shape === drawn) target.setOption(next, { replaceMerge: ['series'], lazyUpdate: true });
		else target.setOption(next, { notMerge: true, lazyUpdate: true });
		drawn = shape;
	});
</script>

<div
	bind:this={host}
	class={cn('w-full', height === 'fill' && 'h-full', className)}
	style:height={height === 'fill' ? undefined : `${height}px`}
	role="img"
	aria-label={label}
	data-testid="chart"
></div>
