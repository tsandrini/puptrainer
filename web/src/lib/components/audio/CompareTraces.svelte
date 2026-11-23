<script lang="ts">
	// Two takes moment by moment on one time axis: a grid per measure with
	// the first take's line and the second's in the measure's hue. The
	// everyday voice is dashed, as everywhere; two takes whose lines would
	// look the same are told apart by the second being fainter. The values
	// are each take's own, so the two can be read against each other
	// directly. The second take can be moved along the axis; a click reports
	// the moment, a drag zooms every grid.
	import type { Intent, Trace } from '#lib/api/types.js';
	import { stepDecimals } from '#lib/charts.js';
	import Plot, { type PlotSeries } from '#lib/components/charts/Plot.svelte';
	import { fitRange, overlay, type Track } from '#lib/compare.js';
	import { fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	/** What is drawn, in this order: its hue, its unit, the least its axis spans, its decimals. */
	const ROWS = [
		{ key: 'pitch_hz', color: 'var(--series-1)', unit: 'Hz', least: 30, decimals: 0 },
		{ key: 'brightness_pct', color: 'var(--series-2)', unit: '%', least: 10, decimals: 1 },
		{ key: 'r1_pct', color: 'var(--series-3)', unit: '%', least: 10, decimals: 1 },
		{ key: 'lightness_db', color: 'var(--series-4)', unit: 'dB', least: 6, decimals: 1 },
		{ key: 'level_db', color: 'var(--series-5)', unit: 'dB', least: 12, decimals: 1 },
		{ key: 'clarity_db', color: 'var(--series-6)', unit: 'dB', least: 6, decimals: 1 }
	] as const;
	/** The everyday voice is dashed, as on every chart; a drill is a sound and is drawn plain. */
	const DASH: Record<Intent, number[] | undefined> = {
		attempt: undefined,
		habitual: [7, 4],
		drill: undefined
	};
	/** A level this far under the take's loudest moment is a pause, not a sound, in dB. */
	const PAUSE_DB = 40;

	let {
		a,
		b,
		voices,
		shift = 0,
		position = 0,
		onseek
	}: {
		a: Trace | null;
		b: Trace | null;
		/** The voice each take was spoken in: its line. */
		voices: [Intent, Intent];
		/** How far the second take is moved along the axis, in seconds. */
		shift?: number;
		/** A moment to mark on every grid, on the first take's clock. */
		position?: number;
		onseek?: (seconds: number) => void;
	} = $props();

	const id = $props.id();
	/** The stretch in view, shared by the grids. */
	let shown = $state<[number, number] | null>(null);

	function track(trace: Trace | null, key: string): Track | null {
		const row = trace?.rows.find((r) => r.key === key);
		if (!trace || !row) return null;
		let values: (number | null)[] = row.values;
		// NOTE: a first resonance that cannot be read is not drawn, here as everywhere
		if (key === 'r1_pct')
			values = values.map((v, index) => (trace.r1_unreadable[index] ? null : v));
		if (key === 'level_db') {
			const top = Math.max(...values.filter((v): v is number => v !== null), -120);
			values = values.map((v) => (v !== null && v < top - PAUSE_DB ? null : v));
		}
		return { start: trace.start_s, step: trace.step_s, values };
	}

	const grids = $derived(
		ROWS.flatMap((row) => {
			const [first, second] = [track(a, row.key), track(b, row.key)];
			if (!first && !second) return [];
			const laid = overlay(first, second, shift);
			const format = (value: number) =>
				`${fmtNumber(value, row.decimals, i18n.locale)} ${row.unit}`;
			const series: PlotSeries[] = [
				...(first
					? [
							{
								key: 'a',
								label: 'A',
								color: row.color,
								values: laid.a,
								dash: DASH[voices[0]],
								format
							}
						]
					: []),
				...(second
					? [
							{
								key: 'b',
								label: 'B',
								color: row.color,
								values: laid.b,
								dash: DASH[voices[1]],
								// NOTE: two takes with the same line are told apart by the second being fainter
								faint: DASH[voices[0]]?.join() === DASH[voices[1]]?.join(),
								format
							}
						]
					: [])
			];
			return [{ ...row, x: laid.x, series, range: fitRange([...laid.a, ...laid.b], row.least) }];
		})
	);
</script>

<div class="space-y-1" data-testid="compare-traces" data-rows={grids.map((g) => g.key).join(' ')}>
	{#each grids as grid, index (grid.key)}
		<div data-grid={grid.key}>
			<p class="pl-12 text-xs font-semibold">
				{i18n.t.traces.rows[grid.key]}
				<span class="font-normal text-muted-foreground">({grid.unit})</span>
			</p>
			<Plot
				x={grid.x}
				series={grid.series}
				label={i18n.t.traces.rows[grid.key]}
				tick={(value, decimals) => fmtNumber(value, decimals, i18n.locale)}
				tickX={(value, step) => `${fmtNumber(value, stepDecimals(step), i18n.locale)} s`}
				height={index === grids.length - 1 ? 112 : 92}
				range={grid.range}
				zero={grid.unit === '%'}
				cursor={position}
				sync="compare-{id}"
				zoomable
				axis={index === grids.length - 1}
				bind:shown
				onpick={(seconds) => onseek?.(seconds)}
			/>
		</div>
	{/each}
</div>
