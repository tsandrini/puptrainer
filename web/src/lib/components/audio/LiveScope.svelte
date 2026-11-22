<script lang="ts">
	// What the microphone hears, live: a scrolling spectrogram of the last
	// seconds with the level under it. A guide while recording; nothing of
	// it is stored. The page hands it the recorder's blocks through `push`.
	import { onDestroy } from 'svelte';
	import {
		LiveSpectrum,
		layoutHeight,
		paintColumn,
		ramp,
		rampTop,
		type View
	} from '#lib/audio/spectrum.js';
	import { LAYOUT, spectrumView } from '#lib/audio/view.svelte.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { theme } from '#lib/theme.svelte.js';
	import FrequencyAxis from './FrequencyAxis.svelte';
	import SpectrumToggle from './SpectrumToggle.svelte';

	let {
		fixed = null
	}: {
		/** The view to show whatever the page's switch says, for a step about one of them. */
		fixed?: View | null;
	} = $props();

	const SECONDS = 6;
	const wanted = () => fixed ?? spectrumView.value;

	let canvas = $state<HTMLCanvasElement | null>(null);
	let live: LiveSpectrum | null = null;
	let rate = 0;
	let view = wanted();
	let frame = 0;
	let columns = $state(0);
	const colours = $derived(ramp(theme.dark));

	/**
	 * Takes in the next block of the recording.
	 *
	 * @param block samples in [-1, 1]
	 * @param sampleRate samples per second
	 */
	export function push(block: Float32Array, sampleRate: number): void {
		if (!live || rate !== sampleRate || view !== wanted()) {
			rate = sampleRate;
			view = wanted();
			live = new LiveSpectrum(sampleRate, view, LAYOUT.rows, SECONDS);
			columns = live.columns;
		}
		if (live.push(block) && !frame) frame = requestAnimationFrame(draw);
	}

	function draw(): void {
		frame = 0;
		const context = canvas?.getContext('2d');
		if (!context || !live || !canvas || canvas.width !== live.columns) return;
		const image = context.createImageData(live.columns, layoutHeight(LAYOUT));
		const top = rampTop(live.topDb);
		for (let x = 0; x < live.columns; x++)
			paintColumn(image, x, live.column(x), top, colours, LAYOUT);
		context.putImageData(image, 0, 0);
	}

	// a new theme repaints what is there
	$effect(() => {
		void colours;
		if (live && !frame) frame = requestAnimationFrame(draw);
	});

	onDestroy(() => cancelAnimationFrame(frame));
</script>

<div data-testid="live-scope">
	<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
		<span class="text-xs text-muted-foreground">{i18n.t.player.live(SECONDS)}</span>
		{#if !fixed}<SpectrumToggle />{/if}
	</div>
	<div class="relative h-44 overflow-hidden rounded-lg border bg-card">
		<canvas
			bind:this={canvas}
			class="absolute inset-0 size-full"
			width={columns || 1}
			height={layoutHeight(LAYOUT)}
			aria-label={i18n.t.player.spectrogram}
		></canvas>
		<FrequencyAxis />
	</div>
</div>
