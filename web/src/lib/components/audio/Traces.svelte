<script lang="ts">
	// A take moment by moment: one small row per measure, all on the time
	// axis of the player's picture, with the playback position running
	// through them. Each row says its value at the pointer, or at the
	// playhead; a click or a drag seeks. The rows come from the analysis
	// (`GET /takes/{id}/trace`) or, right after recording, from the live guide.
	import type { Trace } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { niceTicks } from '#lib/charts.js';
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
		reads
	}: {
		trace: Trace;
		/** Length of the take in seconds: the rows span what the player's picture spans. */
		duration: number;
		/** Where the player stands, in seconds. */
		position?: number;
		/** Called with a time when a moment is clicked or dragged to. */
		onseek?: (seconds: number) => void;
		/** The pitch band to shade in the pitch row. */
		band?: readonly [number, number];
		/** Names of the take's held sounds, in order (an exercise's sequence). */
		labels?: string[];
		/** The rows were drawn by the live guide, not measured by the analysis. */
		live?: boolean;
		/**
		 * The ends of a row's scale, by row: for a picture that moves (the live graph),
		 * where a scale that followed the values would jump. A row with a scale is drawn
		 * even while it is empty.
		 */
		scales?: Record<string, readonly [number, number]>;
		/** What to say under the rows instead of the usual line. */
		reads?: string;
	} = $props();

	const HEIGHT = 60;
	/** A tick this close to the top of its row has no room for its label. */
	const LABEL_ROOM = 13;
	type Kind = { unit: string; signed?: boolean; least?: [number, number]; zone?: string };
	/** How each row is scaled and written; `least` is the range its scale always covers. */
	const KINDS: Record<string, Kind> = {
		pitch_hz: { unit: 'Hz' },
		brightness_pct: { unit: '%', signed: true, least: [-10, 20], zone: 'brightness_pct' },
		r1_pct: { unit: '%', signed: true, least: [-20, 30], zone: 'r1_shift_pct' },
		lightness_db: { unit: 'dB', least: [0, 15] },
		clarity_db: { unit: 'dB' },
		level_db: { unit: 'dB' }
	};

	let plot = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let hover = $state<number | null>(null);
	let dragging = $state(false);

	const span = $derived(
		Math.max(duration, trace.start_s + trace.step_s * (trace.r1_unreadable.length - 0.5), 0.1)
	);
	const x = (seconds: number) => (seconds / span) * width;
	const timeOf = (index: number) => trace.start_s + index * trace.step_s;
	const at = $derived(hover ?? position);

	type Row = {
		key: string;
		kind: Kind;
		values: (number | null)[];
		low: number;
		high: number;
		ticks: number[];
		zone: [number, number] | null;
	};

	const rows = $derived<Row[]>(
		trace.rows.flatMap((row) => {
			const kind = KINDS[row.key];
			const fixed = scales?.[row.key];
			const found = row.values.filter((v): v is number => v !== null).sort((a, b) => a - b);
			if (!kind || (!found.length && !fixed)) return [];
			let low: number;
			let high: number;
			if (fixed) {
				[low, high] = fixed;
			} else {
				// the scale follows the take, not its strays: the 2nd to the 98th percentile
				low = found[Math.floor(0.02 * (found.length - 1))];
				high = found[Math.ceil(0.98 * (found.length - 1))];
				// NOTE: silence lies 40 dB and more under a voice and would flatten its line
				if (row.key === 'level_db') low = Math.max(low, high - 40);
				if (kind.least) [low, high] = [Math.min(low, kind.least[0]), Math.max(high, kind.least[1])];
				if (row.key === 'pitch_hz' && band) {
					[low, high] = [Math.min(low, band[0]), Math.max(high, band[1])];
				}
				const pad = (high - low) * 0.1 || 1;
				[low, high] = [low - pad, high + pad];
			}
			const typical = kind.zone
				? app.measures.find((m) => m.key === kind.zone)?.zones.find((z) => z.key === 'typical')
				: undefined;
			const zone: [number, number] | null =
				row.key === 'pitch_hz' && band
					? [band[0], band[1]]
					: typical && typical.low !== null && typical.high !== null
						? [typical.low, typical.high]
						: null;
			return [
				{
					key: row.key,
					kind,
					values: row.values,
					low,
					high,
					ticks: niceTicks(low, high, 2).filter((t) => t > low && t < high),
					zone
				}
			];
		})
	);

	const y = (row: Row, value: number) =>
		HEIGHT -
		((Math.min(row.high, Math.max(row.low, value)) - row.low) / (row.high - row.low)) * HEIGHT;

	/** The line of a row, broken where there is nothing to read. */
	function line(row: Row): string {
		let d = '';
		let pen = false;
		row.values.forEach((value, index) => {
			if (value === null) {
				pen = false;
				return;
			}
			const point = `${x(timeOf(index)).toFixed(1)} ${y(row, value).toFixed(1)}`;
			// NOTE: a lone value between two gaps is drawn as a dot (a line to itself)
			const alone = !pen && row.values[index + 1] == null;
			d += pen ? `L${point}` : `M${point}${alone ? `L${point}` : ''}`;
			pen = true;
		});
		return d;
	}

	/** Runs of steps where the first resonance cannot be read, as [from, to] in seconds. */
	const unreadable = $derived.by(() => {
		const runs: [number, number][] = [];
		trace.r1_unreadable.forEach((flag, index) => {
			if (!flag) return;
			const from = timeOf(index) - trace.step_s / 2;
			const last = runs[runs.length - 1];
			if (last && Math.abs(last[1] - from) < 1e-6) last[1] = from + trace.step_s;
			else runs.push([from, from + trace.step_s]);
		});
		return runs;
	});

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

	function valueAt(row: Row): string {
		const index = Math.round((at - trace.start_s) / trace.step_s);
		const value = row.values[index];
		if (value == null) {
			return row.key === 'r1_pct' && trace.r1_unreadable[index]
				? i18n.t.traces.unreadable
				: i18n.t.common.none;
		}
		const text = (row.kind.signed ? fmtSigned : fmtNumber)(value, 0, i18n.locale);
		return `${text} ${row.kind.unit}`;
	}

	const tick = (row: Row, value: number) =>
		(row.kind.signed ? fmtSigned : fmtNumber)(value, 0, i18n.locale);

	function seconds(event: PointerEvent): number {
		const box = plot!.getBoundingClientRect();
		const px = Math.min(box.width, Math.max(0, event.clientX - box.left));
		return box.width ? (px / box.width) * span : 0;
	}

	$effect(() => {
		if (!plot) return;
		const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
		observer.observe(plot);
		return () => observer.disconnect();
	});
</script>

{#if rows.length}
	<div
		class="space-y-1"
		data-testid="traces"
		data-rows={rows.map((row) => row.key).join(' ')}
		data-zero={trace.zero}
		data-live={live}
	>
		<!-- NOTE: pointer only; the player above is the keyboard's way to seek -->
		<div
			bind:this={plot}
			class={[
				'relative touch-none overflow-hidden rounded-lg border bg-card select-none',
				onseek && 'cursor-pointer'
			]}
			role="group"
			aria-label={i18n.t.traces.title}
			onpointerdown={(event) => {
				if (!onseek) return;
				dragging = true;
				plot?.setPointerCapture(event.pointerId);
				onseek(seconds(event));
			}}
			onpointermove={(event) => {
				hover = seconds(event);
				if (dragging) onseek?.(hover);
			}}
			onpointerup={() => (dragging = false)}
			onpointercancel={() => (dragging = false)}
			onpointerleave={() => (hover = null)}
			data-testid="traces-plot"
		>
			{#if named.some((s) => s.label)}
				<div
					class="relative h-5 border-b text-[11px] text-muted-foreground"
					data-testid="trace-spans"
				>
					{#each named as s (s.start_s)}
						{#if s.label}
							<span
								class="absolute top-0.5 -translate-x-1/2 whitespace-nowrap"
								style="left: {x((s.start_s + s.end_s) / 2)}px"
							>
								{s.label}
							</span>
						{/if}
					{/each}
				</div>
			{/if}
			{#each rows as row (row.key)}
				<div class="border-b last:border-b-0" data-row={row.key}>
					<div class="flex items-baseline justify-between gap-3 px-2 pt-1 text-xs">
						<span title={i18n.t.traces.hints[row.key]}>
							<span class="font-semibold">{i18n.t.traces.rows[row.key] ?? row.key}</span>
							<span class="text-muted-foreground">({row.kind.unit})</span>
						</span>
						<span class="text-muted-foreground tabular-nums" data-testid="trace-value">
							{valueAt(row)}
						</span>
					</div>
					<svg {width} height={HEIGHT} class="block" aria-hidden="true">
						{#each trace.spans as s (s.start_s)}
							<rect
								x={x(s.start_s)}
								y="0"
								width={Math.max(0, x(s.end_s) - x(s.start_s))}
								height={HEIGHT}
								class="fill-foreground/5"
							/>
						{/each}
						{#if row.zone}
							<rect
								x="0"
								y={y(row, row.zone[1])}
								{width}
								height={Math.max(0, y(row, row.zone[0]) - y(row, row.zone[1]))}
								class="fill-chart-band"
							/>
						{/if}
						{#each row.ticks as value (value)}
							<line
								x1="0"
								x2={width}
								y1={y(row, value)}
								y2={y(row, value)}
								class={row.kind.signed && value === 0 ? 'stroke-border' : 'stroke-chart-grid'}
							/>
							{#if y(row, value) >= LABEL_ROOM}
								<text x="4" y={y(row, value) - 2} class="fill-muted-foreground text-[10px]">
									{tick(row, value)}
								</text>
							{/if}
						{/each}
						{#if row.key === 'r1_pct'}
							{#each unreadable as [from, to] (from)}
								<rect
									x={x(from)}
									y="0"
									width={Math.max(1, x(to) - x(from))}
									height={HEIGHT}
									class="fill-muted-foreground/25"
									data-testid="trace-unreadable"
								/>
							{/each}
						{/if}
						<path
							d={line(row)}
							fill="none"
							stroke="var(--series-1)"
							stroke-width="2"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					</svg>
				</div>
			{/each}
			<div
				class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/80"
				style="left: {x(Math.min(position, span))}px"
				data-testid="trace-playhead"
			></div>
			{#if hover !== null && !dragging}
				<div
					class="pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/40"
					style="left: {x(hover)}px"
				></div>
				<span
					class="pointer-events-none absolute bottom-1 rounded-sm bg-popover/90 px-1.5 py-0.5 text-xs tabular-nums shadow-xs"
					style={x(hover) > width / 2
						? `right: ${width - x(hover) + 6}px`
						: `left: ${x(hover) + 6}px`}
				>
					{fmtNumber(hover, 1, i18n.locale)} s
				</span>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground" data-testid="traces-reads">
			{reads ?? (live ? i18n.t.traces.live : i18n.t.traces.reads)}
			{#if trace.zero && !reads}{i18n.t.traces.zero[trace.zero]}{/if}
			{#if unreadable.length}{i18n.t.traces.shaded}{/if}
			{#if !live && rows.length === 1 && rows[0].key === 'pitch_hz'}{i18n.t.traces.older}{/if}
		</p>
		<details class="text-xs text-muted-foreground">
			<summary class="cursor-pointer">{i18n.t.traces.what}</summary>
			<dl class="mt-1 space-y-1">
				{#each rows as row (row.key)}
					<div>
						<dt class="inline font-semibold text-foreground">{i18n.t.traces.rows[row.key]}:</dt>
						<dd class="inline">{i18n.t.traces.hints[row.key]}</dd>
					</div>
				{/each}
			</dl>
		</details>
	</div>
{/if}
