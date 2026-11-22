<script lang="ts" module>
	/** The ends of the value axis of each grid, for a picture that moves. */
	export type GridScales = {
		pitch: readonly [number, number];
		resonance: readonly [number, number];
		source: readonly [number, number];
	};
</script>

<script lang="ts">
	// A take moment by moment, on the time axis of the player's picture:
	// three grids, one per unit, each with its lines in different colours.
	// Pitch in Hz; the resonances (brightness, the first resonance, and for a
	// take that starts on a held sound the pitch again) in percent against
	// the take's zero; the source (lightness, loudness, clarity) in dB against
	// that zero, or against the middle of the take. The playback position
	// runs through all three; a click seeks, a drag zooms, and the legend
	// under each grid says its values at the pointer. The rows come from the
	// analysis (`GET /takes/{id}/trace`) or, right after recording, from the
	// live guide.
	import type { Trace } from '#lib/api/types.js';
	import { stepDecimals } from '#lib/charts.js';
	import { app } from '#lib/app.svelte.js';
	import Plot, { type PlotSeries, type PlotSpan } from '#lib/components/charts/Plot.svelte';
	import Help from '#lib/components/app/Help.svelte';
	import { fmtNumber, fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let {
		trace,
		duration,
		position = 0,
		onseek,
		band,
		labels = [],
		live = false,
		scales,
		base,
		reads,
		heading
	}: {
		trace: Trace;
		/** Length of the take in seconds: the grids span what the player's picture spans. */
		duration: number;
		/** Where the player stands, in seconds. */
		position?: number;
		/** Called with a time when a moment is clicked. */
		onseek?: (seconds: number) => void;
		/** The pitch band to shade in the pitch grid. */
		band?: readonly [number, number];
		/** Names of the take's held sounds, in order (an exercise's sequence). */
		labels?: string[];
		/** The rows were drawn by the live guide, not measured by the analysis. */
		live?: boolean;
		/** Fixed value axes: for a picture that moves, where following the values would jump. */
		scales?: GridScales;
		/** What the source grid is counted from, by row; worked out from the take without it. */
		base?: Record<string, number>;
		/** What to say under the grids instead of the usual line. */
		reads?: string;
		/** A heading over the grids; the help button sits beside it. */
		heading?: string;
	} = $props();

	const SOURCE = ['lightness_db', 'level_db', 'clarity_db'] as const;
	const COLOR: Record<string, string> = {
		pitch_hz: 'var(--series-1)',
		brightness_pct: 'var(--series-2)',
		r1_pct: 'var(--series-3)',
		lightness_db: 'var(--series-4)',
		level_db: 'var(--series-5)',
		clarity_db: 'var(--series-6)'
	};
	const id = $props.id();

	let shown = $state<[number, number] | null>(null);

	const span = $derived(
		Math.max(duration, trace.start_s + trace.step_s * (trace.r1_unreadable.length - 0.5), 0.1)
	);
	const x = $derived(trace.r1_unreadable.map((_, index) => trace.start_s + index * trace.step_s));
	const row = (key: string) => trace.rows.find((r) => r.key === key)?.values ?? null;
	const has = (key: string) => (row(key) ?? []).some((v) => v !== null);
	const present = $derived(
		trace.rows.filter((r) => live || r.values.some((v) => v !== null)).map((r) => r.key)
	);

	const median = (values: number[]): number | null => {
		if (!values.length) return null;
		const sorted = [...values].sort((a, b) => a - b);
		const half = sorted.length >> 1;
		return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
	};

	/** The steps of the take's zero: its first held sound, when it is counted from one. */
	const first = $derived(
		trace.zero === 'first-sound' ? (trace.spans.find((s) => s.kind === 'held') ?? null) : null
	);
	/** A row's values over the zero (or over the whole take), for what it is counted from. */
	function middle(key: string): number | null {
		const values = row(key);
		if (!values) return null;
		const pitch = row('pitch_hz');
		const kept = values.flatMap((value, index) => {
			if (value === null) return [];
			if (first && (x[index] < first.start_s || x[index] > first.end_s)) return [];
			// NOTE: the level of a silence says nothing about the voice: only where it sounds
			if (key === 'level_db' && pitch && pitch[index] === null && !first) return [];
			return [value];
		});
		return median(kept);
	}
	const zeros = $derived<Record<string, number | null>>({
		pitch_hz: first ? middle('pitch_hz') : null,
		...Object.fromEntries(SOURCE.map((key) => [key, base?.[key] ?? (base ? null : middle(key))]))
	});

	/**
	 * A value axis that follows its lines, not their strays: from the 2nd to the 98th
	 * percentile of each, and always over `least`.
	 */
	function fit(lines: PlotSeries[], least: readonly number[]): [number, number] {
		let [low, high] = [Math.min(...least), Math.max(...least)];
		for (const line of lines) {
			const found = line.values.filter((v): v is number => v !== null).sort((a, b) => a - b);
			if (!found.length) continue;
			low = Math.min(low, found[Math.floor(0.02 * (found.length - 1))]);
			high = Math.max(high, found[Math.ceil(0.98 * (found.length - 1))]);
		}
		const pad = (high - low) * 0.08 || 1;
		return [low - pad, high + pad];
	}

	/** Where the take sounds: a voice, or a whisper that was read. Elsewhere a level is the room's. */
	const sounding = $derived.by(() => {
		const hz = row('pitch_hz');
		const bright = row('brightness_pct');
		return x.map(
			(_, index) => (hz?.[index] ?? null) !== null || (bright?.[index] ?? null) !== null
		);
	});

	const number = (value: number, decimals = 0) => fmtNumber(value, decimals, i18n.locale);
	const signed = (value: number, decimals = 0) => fmtSigned(value, decimals, i18n.locale);
	const title = (key: string) => i18n.t.traces.rows[key] ?? key;

	const pitch = $derived<PlotSeries[]>(
		row('pitch_hz')
			? [
					{
						key: 'pitch_hz',
						label: title('pitch_hz'),
						color: COLOR.pitch_hz,
						values: row('pitch_hz')!,
						format: (value) => {
							const zero = zeros.pitch_hz;
							const against = zero ? ` (${signed((value / zero - 1) * 100)} %)` : '';
							return `${number(value)} Hz${against}`;
						}
					}
				]
			: []
	);

	const resonance = $derived.by<PlotSeries[]>(() => {
		const made: PlotSeries[] = [];
		const zero = zeros.pitch_hz;
		const hz = row('pitch_hz');
		if (zero && hz && (has('brightness_pct') || has('r1_pct'))) {
			made.push({
				key: 'pitch_pct',
				label: i18n.t.traces.rows.pitch_pct,
				color: COLOR.pitch_hz,
				faint: true,
				values: hz.map((value) => (value === null ? null : (value / zero - 1) * 100)),
				format: (value) => `${signed(value)} %`
			});
		}
		for (const key of ['brightness_pct', 'r1_pct']) {
			const values = row(key);
			if (!values || (!live && !has(key))) continue;
			made.push({
				key,
				label: title(key),
				color: COLOR[key],
				values,
				format: (value) => `${signed(value)} %`,
				blank: (index) =>
					key === 'r1_pct' && trace.r1_unreadable[index] ? i18n.t.traces.unreadable : null
			});
		}
		return made;
	});

	const source = $derived<PlotSeries[]>(
		SOURCE.flatMap((key) => {
			const values = row(key);
			const zero = zeros[key];
			if (!values || (!live && !has(key))) return [];
			return [
				{
					key,
					label: title(key),
					color: COLOR[key],
					values: values.map((value, index) =>
						value === null || zero == null || !sounding[index] ? null : value - zero
					),
					format: (value: number) => `${number(value + (zero ?? 0))} dB (${signed(value)})`
				}
			];
		})
	);

	/** Runs of steps where the first resonance cannot be read, as stretches of the x axis. */
	const muted = $derived.by<PlotSpan[]>(() => {
		const runs: PlotSpan[] = [];
		trace.r1_unreadable.forEach((flag, index) => {
			if (!flag) return;
			const from = x[index] - trace.step_s / 2;
			const last = runs[runs.length - 1];
			if (last && Math.abs(last.to - from) < 1e-6) last.to = from + trace.step_s;
			else runs.push({ from, to: from + trace.step_s, tone: 'mute' });
		});
		return runs;
	});
	const sounds = $derived<PlotSpan[]>(
		trace.spans.map((s) => ({ from: s.start_s, to: s.end_s, tone: 'sound' }))
	);

	/** The take's sounds with their names: held ones from the exercise, whispers as such. */
	const named = $derived.by(() => {
		const held = trace.spans.filter((s) => s.kind === 'held');
		let next = 0;
		return trace.spans.map((s) => ({
			...s,
			label:
				s.kind === 'whisper'
					? i18n.t.traces.whisper
					: held.length === labels.length
						? labels[next++]
						: ''
		}));
	});

	const zone = $derived(
		app.measures.find((m) => m.key === 'brightness_pct')?.zones.find((z) => z.key === 'typical')
	);
	const seconds = (value: number, step: number) => `${number(value, stepDecimals(step))} s`;
	const grid = $derived({
		x,
		tickX: seconds,
		cursor: Math.min(position, span),
		sync: `traces-${id}`,
		zoomable: !live,
		onpick: onseek ? (at: number) => onseek(Math.min(span, Math.max(0, at))) : undefined
	});
	const counted = $derived(
		zeros.lightness_db !== null || zeros.level_db !== null
			? first || base
				? i18n.t.traces.grids.source
				: i18n.t.traces.grids.sourceOwn
			: i18n.t.traces.grids.source
	);
	const shownKeys = $derived([...pitch, ...resonance, ...source].map((s) => s.key));
</script>

{#if pitch.length || resonance.length || source.length}
	<div
		class="space-y-1"
		data-testid="traces"
		data-rows={present.join(' ')}
		data-zero={trace.zero}
		data-live={live}
	>
		<div class="flex items-center gap-1">
			{#if heading}<h3 class="text-sm font-bold">{heading}</h3>{/if}
			<Help title={heading ?? i18n.t.traces.title} text={reads ?? i18n.t.traces.reads} wide>
				<dl class="space-y-1 text-sm text-muted-foreground" data-testid="traces-rows">
					{#each shownKeys as key (key)}
						<div>
							<dt class="inline font-semibold text-foreground">{i18n.t.traces.rows[key]}:</dt>
							<dd class="inline">{i18n.t.traces.hints[key]}</dd>
						</div>
					{/each}
				</dl>
			</Help>
		</div>
		<div class="rounded-lg border bg-card p-2" data-testid="traces-plot">
			{#if named.some((s) => s.label) && shown === null}
				<!-- NOTE: the plotting area starts 48 px in and ends 10 px short, as in `Plot` -->
				<div
					class="relative mr-2.5 ml-12 h-4 text-[11px] text-muted-foreground"
					data-testid="trace-spans"
				>
					{#each named as s (s.start_s)}
						{#if s.label}
							<span
								class="absolute top-0 -translate-x-1/2 whitespace-nowrap"
								style="left: {(((s.start_s + s.end_s) / 2 - x[0]) / (x[x.length - 1] - x[0])) *
									100}%"
							>
								{s.label}
							</span>
						{/if}
					{/each}
				</div>
			{/if}
			{#if pitch.length}
				<div data-grid="pitch">
					<p class="pl-12 text-xs font-semibold">{i18n.t.traces.grids.pitch}</p>
					<Plot
						{...grid}
						bind:shown
						series={pitch}
						label={i18n.t.traces.grids.pitch}
						tick={number}
						height={120}
						range={scales?.pitch ?? fit(pitch, band ?? [])}
						zones={band ? [{ low: band[0], high: band[1] }] : []}
						spans={sounds}
						axis={!resonance.length && !source.length}
					/>
				</div>
			{/if}
			{#if resonance.length}
				<div data-grid="resonance">
					<p class="pl-12 text-xs font-semibold">{i18n.t.traces.grids.resonance}</p>
					<Plot
						{...grid}
						bind:shown
						series={resonance}
						label={i18n.t.traces.grids.resonance}
						tick={signed}
						height={150}
						range={scales?.resonance ?? fit(resonance, [-10, 20])}
						axis={!source.length}
						zero
						zones={zone && zone.low !== null && zone.high !== null
							? [{ low: zone.low, high: zone.high }]
							: []}
						spans={[...sounds, ...muted]}
					/>
				</div>
			{/if}
			{#if source.length}
				<div data-grid="source">
					<p class="pl-12 text-xs font-semibold">{counted}</p>
					<Plot
						{...grid}
						bind:shown
						series={source}
						label={counted}
						tick={signed}
						height={130}
						range={scales?.source ?? fit(source, [-6, 6])}
						zero
						spans={sounds}
					/>
				</div>
			{/if}
		</div>
		<!-- NOTE: what this picture is counted from and what it leaves out: state, not explanation -->
		<p class="text-xs text-muted-foreground" data-testid="traces-reads">
			{#if live && !reads}{i18n.t.traces.live}{/if}
			{#if trace.zero && !reads}{i18n.t.traces.zero[trace.zero]}{/if}
			{#if muted.length}{i18n.t.traces.shaded}{/if}
			{#if !live && present.length === 1 && present[0] === 'pitch_hz'}{i18n.t.traces.older}{/if}
		</p>
	</div>
{/if}
