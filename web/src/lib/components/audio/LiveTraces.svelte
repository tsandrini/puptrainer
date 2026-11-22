<script lang="ts">
	// The last seconds of what the microphone hears, as rows over time: pitch,
	// brightness, the first resonance, lightness and loudness, the newest
	// moment at the right edge. For a held sound also a map of pitch against
	// brightness, on which the voice leaves a trail: straight up is resonance
	// without pitch, a diagonal is both together. A guide while recording;
	// nothing of it is stored. The page hands it the recorder's blocks
	// through `push` and may ask for the whole take with `history`.
	import type { Trace } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import type { Formants, Mode } from '#lib/audio/formants.js';
	import { LiveTrack } from '#lib/audio/live.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import Traces, { type GridScales } from './Traces.svelte';

	let {
		mode = 'voiced',
		base = null,
		speech = false,
		resonance = true,
		own = true,
		band,
		unreadable = $bindable(false)
	}: {
		/** A voice, or a whisper that a voice may come into. */
		mode?: Mode;
		/** What brightness and R1 are counted from; null until there is a zero. */
		base?: Formants | null;
		/** Running speech: brightness as a slow line, no R1 row, no map. */
		speech?: boolean;
		/** With the resonance rows; without them for a pitch exercise. */
		resonance?: boolean;
		/** The zero is the take's own first sound (not one set by hand, nor the everyday voice). */
		own?: boolean;
		/** The learner's pitch band, shaded in the pitch row and on the map. */
		band?: readonly [number, number];
		/** Right now the voice is too light for its first resonance to be read. */
		unreadable?: boolean;
	} = $props();

	/** How much of the stream the graph shows: long enough for a whole rep of a drill. */
	const WINDOW_S = 30;
	const STEP_S = 0.1;
	/** Blocks between two drawings: about eight a second. */
	const EVERY = 3;
	/** How long the trail on the map is, in seconds. */
	const TRAIL_S = 4;
	const SIDE = 200;
	const BRIGHT: [number, number] = [-20, 40];

	// svelte-ignore state_referenced_locally
	const track = new LiveTrack(mode);
	let blocks = 0;
	let shown = $state.raw<Trace | null>(null);
	let trail = $state.raw<{ at: number; pitchHz: number; brightPct: number }[]>([]);

	const pitchRange = $derived<[number, number]>(band ? [band[0] * 0.6, band[1] * 1.5] : [90, 330]);
	const scales = $derived<GridScales>({
		pitch: pitchRange,
		resonance: [-30, 45],
		source: [-20, 20]
	});
	/** What the source grid is counted from: the first second of sound of this take. */
	let origin = $state.raw<Record<string, number>>({});
	const mapped = $derived(resonance && !speech && mode === 'voiced');
	const zone = $derived(
		app.measures.find((m) => m.key === 'brightness_pct')?.zones.find((z) => z.key === 'typical')
	);
	const rows = $derived({ base, speech, resonance });
	const zero = $derived(own ? (mode === 'whisper' ? 'first-whisper' : 'first-sound') : null);

	/**
	 * Takes in the next block of the recording.
	 *
	 * @param block samples in [-1, 1]
	 * @param sampleRate samples per second
	 * @param pitchHz the block's pitch, or null when it has none
	 */
	export function push(block: Float32Array, sampleRate: number, pitchHz: number | null): void {
		track.push(block, sampleRate, pitchHz);
		if (++blocks % EVERY) return;
		const now = track.seconds;
		shown = track.trace(now - WINDOW_S, now, STEP_S, rows);
		if (origin.level_db === undefined) {
			const first = track.opening();
			if (first) {
				origin = {
					level_db: first.levelDb,
					...(first.leadDb !== null ? { lightness_db: first.leadDb } : {})
				};
			}
		}
		unreadable = shown.r1_unreadable.slice(-3).some(Boolean);
		if (!mapped) return;
		const at = track.now(base);
		const kept = trail.filter((point) => point.at > now - TRAIL_S);
		trail = at ? [...kept, { at: now, ...at }] : kept;
	}

	/** Everything heard so far as one trace, for the picture of the take just recorded. */
	export function history(): Trace | null {
		return track.seconds > 0 ? track.trace(0, track.seconds, STEP_S, rows, zero) : null;
	}

	const px = (hz: number) =>
		(Math.log(Math.min(pitchRange[1], Math.max(pitchRange[0], hz)) / pitchRange[0]) /
			Math.log(pitchRange[1] / pitchRange[0])) *
		SIDE;
	const py = (pct: number) =>
		SIDE -
		((Math.min(BRIGHT[1], Math.max(BRIGHT[0], pct)) - BRIGHT[0]) / (BRIGHT[1] - BRIGHT[0])) * SIDE;
	const last = $derived(trail[trail.length - 1] ?? null);
</script>

<div
	class={['grid items-start gap-3', mapped && 'md:grid-cols-[minmax(0,1fr)_13rem]']}
	data-testid="live-traces"
	data-mode={mode}
>
	<div>
		{#if shown}
			<Traces
				heading={i18n.t.live.graph.title(WINDOW_S)}
				trace={shown}
				duration={WINDOW_S}
				position={WINDOW_S - STEP_S / 2}
				{band}
				{scales}
				base={origin}
				live
				reads={speech && resonance ? i18n.t.live.graph.speech : i18n.t.live.graph.reads}
			/>
		{:else}
			<p class="mb-1 text-sm font-bold">{i18n.t.live.graph.title(WINDOW_S)}</p>
			<p class="text-xs text-muted-foreground">{i18n.t.live.waiting}</p>
		{/if}
	</div>
	{#if mapped}
		<div data-testid="live-map" data-points={trail.length}>
			<p class="mb-1 text-sm font-bold">{i18n.t.live.graph.map}</p>
			<svg
				viewBox="0 0 {SIDE} {SIDE}"
				class="w-full max-w-64 rounded-lg border bg-card"
				role="img"
				aria-label={i18n.t.live.graph.map}
			>
				{#if band}
					<rect
						x={px(band[0])}
						y="0"
						width={px(band[1]) - px(band[0])}
						height={SIDE}
						class="fill-chart-band"
					/>
				{/if}
				{#if zone && zone.low !== null && zone.high !== null}
					<rect
						x="0"
						y={py(zone.high)}
						width={SIDE}
						height={py(zone.low) - py(zone.high)}
						class="fill-chart-band"
					/>
				{/if}
				<line x1="0" x2={SIDE} y1={py(0)} y2={py(0)} class="stroke-border" />
				<text x="4" y="12" class="fill-muted-foreground text-[10px]">
					↑ {i18n.t.live.graph.brightAxis}
				</text>
				<text x={SIDE - 4} y={SIDE - 5} text-anchor="end" class="fill-muted-foreground text-[10px]">
					{i18n.t.live.graph.pitchAxis} →
				</text>
				{#if trail.length > 1}
					<polyline
						points={trail
							.map((p) => `${px(p.pitchHz).toFixed(1)},${py(p.brightPct).toFixed(1)}`)
							.join(' ')}
						fill="none"
						stroke="var(--series-1)"
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
						opacity="0.45"
					/>
				{/if}
				{#if last}
					<circle
						cx={px(last.pitchHz)}
						cy={py(last.brightPct)}
						r="5"
						fill="var(--series-1)"
						class="stroke-card"
						stroke-width="2"
					/>
				{/if}
			</svg>
			<p class="mt-1 text-xs text-muted-foreground">{i18n.t.live.graph.mapReads}</p>
		</div>
	{/if}
</div>
