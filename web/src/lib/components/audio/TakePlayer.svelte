<script lang="ts">
	// Plays a take, stored or not yet saved, over a picture of the whole of
	// it: a spectrogram with the level under it. A playhead moves across
	// while it plays and a meter shows the level there; click or drag to
	// seek. It never starts by itself. The picture is a guide: the take's
	// numbers come from the analysis.
	import { onDestroy } from 'svelte';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { claimSound, releaseSound } from '#lib/audio/focus.js';
	import { levelOf } from '#lib/audio/meter.js';
	import {
		Analyser,
		frequencyAt,
		layoutHeight,
		paintColumn,
		ramp,
		rampTop,
		takeColumn,
		type Column
	} from '#lib/audio/spectrum.js';
	import { LAYOUT, spectrumView } from '#lib/audio/view.svelte.js';
	import Meter from '#lib/components/app/Meter.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDuration, fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { theme } from '#lib/theme.svelte.js';
	import FrequencyAxis from './FrequencyAxis.svelte';
	import SpectrumToggle from './SpectrumToggle.svelte';

	let {
		source,
		name = 'take',
		position = $bindable(0),
		duration = $bindable(0)
	}: {
		/** Where the recording is (a URL), or the recording itself. */
		source: string | ArrayBuffer;
		/** File name offered for the download. */
		name?: string;
		/** Where the playback stands, in seconds: for what is drawn beside the player. */
		position?: number;
		/** Length of the recording in seconds, 0 until it is decoded. */
		duration?: number;
	} = $props();

	/** The rate takes are decoded to for the picture. */
	const RATE = 48000;
	const MAX_COLUMNS = 1600;
	const METER_BLOCK = 2048;
	/** How long the picture may hold the page at a time, in ms. */
	const SLICE_MS = 12;
	const total = layoutHeight(LAYOUT);

	type Problem = 'missing' | 'unreachable' | 'undecodable';

	let audio = $state<HTMLAudioElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let plot = $state<HTMLDivElement | null>(null);
	let url = $state<string | null>(null);
	let samples = $state.raw<Float32Array | null>(null);
	let problem = $state<Problem | null>(null);
	let width = $state(0);
	let picture = $state.raw<Column[] | null>(null);
	let playing = $state(false);
	let current = $state(0);
	let length = $state(0);
	let hover = $state<{ x: number; seconds: number; hz: number | null } | null>(null);
	let dragging = $state(false);

	// NOTE: one way only: the page reads these, and moves the playback with `seek`
	$effect(() => {
		position = current;
	});
	$effect(() => {
		duration = length;
	});

	const colours = $derived(ramp(theme.dark));
	const hoverText = $derived.by(() => {
		if (!hover) return '';
		const time = `${fmtNumber(hover.seconds, 1, i18n.locale)} s`;
		if (hover.hz === null) return time;
		return `${time} · ${fmtNumber(Math.round(hover.hz / 10) * 10, 0, i18n.locale)} Hz`;
	});
	const levelDb = $derived.by(() => {
		if (!samples) return -120;
		const at = Math.floor(current * RATE);
		return levelOf(samples.subarray(at, at + METER_BLOCK)).peakDb;
	});

	// --- the recording: fetched once, played from the same bytes it is drawn from
	$effect(() => {
		const from = source;
		let cancelled = false;
		let made: string | null = null;
		samples = null;
		picture = null;
		problem = null;
		url = null;
		current = 0;
		length = 0;
		void (async () => {
			let bytes: ArrayBuffer;
			let type = 'audio/wav';
			if (typeof from === 'string') {
				try {
					const response = await fetch(from);
					if (!response.ok) throw new Error(String(response.status));
					type = response.headers.get('content-type') ?? type;
					bytes = await response.arrayBuffer();
				} catch (e) {
					if (!cancelled) problem = e instanceof TypeError ? 'unreachable' : 'missing';
					return;
				}
			} else {
				bytes = from;
			}
			if (cancelled) return;
			made = URL.createObjectURL(new Blob([bytes], { type }));
			url = made;
			try {
				// NOTE: decoding detaches the buffer it is given
				const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice(0));
				if (cancelled) return;
				const mono = new Float32Array(decoded.length);
				for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
					const data = decoded.getChannelData(channel);
					for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
				}
				samples = mono;
				length = decoded.duration;
			} catch {
				if (!cancelled) problem = 'undecodable';
			}
		})();
		return () => {
			cancelled = true;
			if (made) URL.revokeObjectURL(made);
		};
	});

	// --- the picture: one column per pixel, computed in slices so the page stays responsive
	$effect(() => {
		const sound = samples;
		const columns = Math.min(MAX_COLUMNS, Math.round(width * Math.min(2, devicePixelRatio)));
		const view = spectrumView.value;
		picture = null;
		if (!sound || columns < 2) return;
		let cancelled = false;
		void (async () => {
			const analyser = new Analyser(RATE, view, LAYOUT.rows);
			const made: Column[] = [];
			let since = performance.now();
			for (let column = 0; column < columns; column++) {
				made.push(takeColumn(analyser, sound, column, columns));
				if (performance.now() - since > SLICE_MS) {
					await new Promise((resolve) => setTimeout(resolve));
					if (cancelled) return;
					since = performance.now();
				}
			}
			picture = made;
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const columns = picture;
		const context = canvas?.getContext('2d');
		if (!columns || !context || !canvas) return;
		canvas.width = columns.length;
		const image = context.createImageData(columns.length, total);
		let loudest = -Infinity;
		for (const column of columns) for (const db of column.db) if (db > loudest) loudest = db;
		const top = rampTop(loudest);
		columns.forEach((column, x) => paintColumn(image, x, column, top, colours, LAYOUT));
		context.putImageData(image, 0, 0);
	});

	$effect(() => {
		if (!plot) return;
		const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
		observer.observe(plot);
		return () => observer.disconnect();
	});

	// --- playback
	const owner = Symbol('take player');
	$effect(() => {
		if (!playing) return;
		let frame = requestAnimationFrame(function tick() {
			if (audio) current = audio.currentTime;
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	});

	onDestroy(() => {
		audio?.pause();
		releaseSound(owner);
	});

	function toggle(): void {
		if (!audio || !url) return;
		if (!audio.paused) {
			audio.pause();
			return;
		}
		// NOTE: one thing sounds at a time: another player on the page, or the dock, stops
		const element = audio;
		claimSound(owner, () => element.pause());
		if (length && audio.currentTime >= length - 0.02) audio.currentTime = 0;
		void audio.play().catch(() => (playing = false));
	}

	/**
	 * Moves the playback.
	 *
	 * @param seconds where to, from the start of the recording
	 */
	export function seek(seconds: number): void {
		if (!audio || !length) return;
		const to = Math.min(length, Math.max(0, seconds));
		audio.currentTime = to;
		current = to;
	}

	function pointer(event: PointerEvent): { seconds: number; hz: number | null; x: number } {
		const box = plot!.getBoundingClientRect();
		const x = Math.min(box.width, Math.max(0, event.clientX - box.left));
		// the spectrogram is the upper part of the picture
		const up = 1 - ((event.clientY - box.top) / box.height) * (total / LAYOUT.rows);
		return {
			x,
			seconds: box.width ? (x / box.width) * length : 0,
			hz: up >= 0 && up <= 1 ? frequencyAt(up, RATE) : null
		};
	}

	function onkeydown(event: KeyboardEvent): void {
		const step = event.shiftKey ? 5 : 1;
		if (event.key === ' ' || event.key === 'Enter') toggle();
		else if (event.key === 'ArrowLeft') seek(current - step);
		else if (event.key === 'ArrowRight') seek(current + step);
		else if (event.key === 'Home') seek(0);
		else if (event.key === 'End') seek(length);
		else return;
		event.preventDefault();
	}
</script>

<div class="space-y-2" data-testid="player" data-ready={picture !== null} data-problem={problem}>
	<!-- NOTE: the bytes the picture is drawn from; no controls, the player draws its own -->
	<audio
		bind:this={audio}
		src={url}
		preload="auto"
		onplay={() => (playing = true)}
		onpause={() => (playing = false)}
		onended={() => {
			playing = false;
			current = length;
		}}
	></audio>

	{#if problem === 'missing' || problem === 'unreachable'}
		<p class="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm" role="alert">
			{i18n.t.player.problems[problem]}
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<Button
				size="icon"
				class="rounded-full"
				disabled={!url}
				aria-label={playing ? i18n.t.player.pause : i18n.t.player.play}
				onclick={toggle}
				data-testid="player-toggle"
				data-playing={playing}
			>
				{#if playing}
					<PauseIcon class="size-4 fill-current" />
				{:else}
					<PlayIcon class="size-4 fill-current" />
				{/if}
			</Button>
			<span class="font-mono text-sm tabular-nums" data-testid="player-time" data-seconds={current}>
				{fmtDuration(Math.floor(current))} / {length ? fmtDuration(length) : i18n.t.common.none}
			</span>
			<div class="ml-auto flex items-center gap-1">
				{#if !problem}<SpectrumToggle />{/if}
				{#if url}
					<Button
						variant="ghost"
						size="icon"
						href={typeof source === 'string' ? source : url}
						download={name}
						aria-label={i18n.t.player.download}
						title={i18n.t.player.download}
						data-testid="player-download"
					>
						<DownloadIcon class="size-4" />
					</Button>
				{/if}
			</div>
		</div>

		{#if problem === 'undecodable'}
			<p class="text-sm text-muted-foreground" role="alert">{i18n.t.player.problems.undecodable}</p>
		{:else}
			<div
				bind:this={plot}
				class="relative h-52 cursor-pointer touch-none overflow-hidden rounded-lg border bg-card outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
				role="slider"
				tabindex="0"
				aria-label={i18n.t.player.position}
				aria-valuemin={0}
				aria-valuemax={Math.round(length)}
				aria-valuenow={Math.round(current)}
				aria-valuetext={fmtDuration(current)}
				{onkeydown}
				onpointerdown={(event) => {
					dragging = true;
					plot?.setPointerCapture(event.pointerId);
					seek(pointer(event).seconds);
				}}
				onpointermove={(event) => {
					hover = pointer(event);
					if (dragging) seek(hover.seconds);
				}}
				onpointerup={() => (dragging = false)}
				onpointercancel={() => (dragging = false)}
				onpointerleave={() => (hover = null)}
				data-testid="player-plot"
			>
				<canvas
					bind:this={canvas}
					class="absolute inset-0 size-full"
					height={total}
					aria-label={i18n.t.player.spectrogram}
				></canvas>
				{#if picture === null}
					<p class="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
						{i18n.t.player.drawing}
					</p>
				{:else}
					<FrequencyAxis />
				{/if}
				{#if length}
					<div
						class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/80"
						style="left: {(current / length) * 100}%"
						data-testid="playhead"
					></div>
				{/if}
				{#if hover && length && !dragging}
					<div
						class="pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/40"
						style="left: {hover.x}px"
					></div>
					<span
						class="pointer-events-none absolute top-1 rounded-sm bg-popover/90 px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums shadow-xs"
						style={hover.x > width / 2
							? `right: ${width - hover.x + 6}px`
							: `left: ${hover.x + 6}px`}
					>
						{hoverText}
					</span>
				{/if}
			</div>
			<Meter peakDb={levelDb} />
		{/if}
	{/if}
</div>
