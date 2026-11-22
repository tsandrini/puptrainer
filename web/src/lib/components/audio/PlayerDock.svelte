<script lang="ts">
	// The dock: the app's player along the bottom of every page. A take sent
	// here from a table row or a chart's point goes on sounding while other
	// pages are opened. Its seek bar is the take itself: the level as a
	// shape, the pitch as a line over it. Previous and next walk through the
	// list the take came from. The element that sounds lives here.
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ListEndIcon from '@lucide/svelte/icons/list-end';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import SkipForwardIcon from '@lucide/svelte/icons/skip-forward';
	import XIcon from '@lucide/svelte/icons/x';
	import { cachedTrace } from '#lib/api/traces.js';
	import type { Trace } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import Help from '#lib/components/app/Help.svelte';
	import VoiceMark from '#lib/components/app/VoiceMark.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { fmtDateTime, fmtDuration } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { RATES, player } from '#lib/player.svelte.js';
	import { cn } from '#lib/utils.js';

	const HEIGHT = 34;
	/** The level's shape spans this much below the loudest moment, in dB. */
	const DEPTH_DB = 36;
	const STEP_S = 5;

	let audio = $state<HTMLAudioElement | null>(null);
	let bar = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let trace = $state.raw<Trace | null>(null);
	let dragging = false;

	const take = $derived(player.take);
	const length = $derived(player.duration || take?.duration_s || 0);
	const exercise = $derived(app.exerciseOf(take?.exercise_ref));
	const passage = $derived(app.passage(take?.content_ref));
	const what = $derived(
		take
			? (exercise ? i18n.pick(exercise.titles) : i18n.t.item[take.item]) +
					(take.language ? `, ${i18n.language(take.language)}` : '')
			: ''
	);

	const row = (key: string) => trace?.rows.find((r) => r.key === key)?.values ?? [];
	/** The take as two paths over the bar's width: the level's shape and the pitch's line. */
	const contour = $derived.by(() => {
		const shown = trace;
		if (!shown || !width || !length) return null;
		const at = (index: number) => ((shown.start_s + index * shown.step_s) / length) * width;
		const levels = row('level_db');
		const top = Math.max(...levels.filter((v): v is number => v !== null), -120);
		let shape = `M0 ${HEIGHT}`;
		levels.forEach((value, index) => {
			const share =
				value === null ? 0 : Math.min(Math.max((value - top + DEPTH_DB) / DEPTH_DB, 0), 1);
			shape += ` L${at(index).toFixed(1)} ${(HEIGHT - share * (HEIGHT - 2)).toFixed(1)}`;
		});
		shape += ` L${width} ${HEIGHT} Z`;
		const pitches = row('pitch_hz').map((v) => (v === null || v <= 0 ? null : Math.log2(v)));
		const heard = pitches.filter((v): v is number => v !== null).sort((a, b) => a - b);
		let line = '';
		if (heard.length > 1) {
			// NOTE: the middle 96% of the pitch: a stray octave must not flatten the line
			const [low, high] = [
				heard[Math.floor(heard.length * 0.02)],
				heard[Math.ceil(heard.length * 0.98) - 1]
			];
			const span = Math.max(high - low, 0.25);
			let pen = false;
			pitches.forEach((value, index) => {
				if (value === null) return void (pen = false);
				const share = Math.min(Math.max((value - low) / span, 0), 1);
				line += `${pen ? 'L' : 'M'}${at(index).toFixed(1)} ${(HEIGHT - 4 - share * (HEIGHT - 8)).toFixed(1)} `;
				pen = true;
			});
		}
		return { shape, line };
	});
	const played = $derived(length ? Math.min(player.position / length, 1) * width : 0);

	function seekTo(event: PointerEvent): void {
		if (!bar || !length) return;
		const box = bar.getBoundingClientRect();
		player.seek(((event.clientX - box.left) / box.width) * length);
	}

	function keys(event: KeyboardEvent): void {
		if (!take || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		// NOTE: typing, and keys that belong to a focused control, are not ours
		if (target?.closest('input, textarea, select, [contenteditable], [role=slider], [role=dialog]'))
			return;
		const key = event.key.toLowerCase();
		if (key === 'k' || (key === ' ' && target === document.body)) {
			if (player.playing) player.pause();
			else player.resume();
		} else if (key === 'j') player.seek(player.position - STEP_S);
		else if (key === 'l') player.seek(player.position + STEP_S);
		else if (key === 'n') player.step(1);
		else if (key === 'p') player.step(-1);
		else return;
		event.preventDefault();
	}

	$effect(() => {
		player.attach(audio);
		return () => player.attach(null);
	});

	// the take's contour behind the seek bar
	$effect(() => {
		const current = take;
		trace = null;
		if (!current?.series.length) return;
		let stale = false;
		cachedTrace(current.id)
			.then((found) => {
				if (!stale) trace = found;
			})
			.catch(() => {
				// NOTE: a plain bar does the job without it
			});
		return () => (stale = true);
	});

	// a playhead that runs, not one that steps four times a second
	$effect(() => {
		const element = audio;
		if (!player.playing || !element) return;
		let frame = requestAnimationFrame(function run() {
			if (!dragging) player.position = element.currentTime;
			frame = requestAnimationFrame(run);
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<svelte:window onkeydown={keys} />

<audio
	bind:this={audio}
	preload="none"
	onplay={() => (player.playing = true)}
	onpause={() => {
		player.playing = false;
	}}
	onended={() => player.ended()}
	ondurationchange={() => {
		if (audio && Number.isFinite(audio.duration) && audio.duration > 0)
			player.duration = audio.duration;
	}}
	ontimeupdate={() => {
		if (audio && !dragging) player.position = audio.currentTime;
	}}
	onerror={() => {
		if (!take) return;
		player.problem = 'failed';
		player.playing = false;
	}}
	data-testid="dock-audio"
></audio>

{#if take}
	<aside
		class="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 shadow-[0_-6px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur"
		aria-label={i18n.t.dock.label}
		data-testid="dock"
		data-take={take.id}
		data-playing={player.playing}
		data-queue={player.queue.length}
	>
		<div class="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
			<div class="flex items-center gap-1">
				<Button
					size="icon-sm"
					variant="ghost"
					disabled={player.index <= 0}
					aria-label={i18n.t.dock.previous}
					title={i18n.t.dock.previous}
					onclick={() => player.step(-1)}
					data-testid="dock-previous"
				>
					<SkipBackIcon />
				</Button>
				<Button
					size="icon-lg"
					class="rounded-full"
					aria-label={player.playing ? i18n.t.player.pause : i18n.t.player.play}
					onclick={() => (player.playing ? player.pause() : player.resume())}
					data-testid="dock-toggle"
				>
					{#if player.playing}<PauseIcon class="fill-current" />{:else}<PlayIcon
							class="fill-current"
						/>{/if}
				</Button>
				<Button
					size="icon-sm"
					variant="ghost"
					disabled={player.index >= player.queue.length - 1}
					aria-label={i18n.t.dock.next}
					title={i18n.t.dock.next}
					onclick={() => player.step(1)}
					data-testid="dock-next"
				>
					<SkipForwardIcon />
				</Button>
			</div>

			<div class="min-w-0 basis-64 text-sm leading-tight sm:max-w-md">
				<a
					class="flex items-center gap-1.5 truncate font-bold underline-offset-4 hover:underline"
					href="/takes/{take.id}"
					data-testid="dock-open"
				>
					<span class="truncate">{fmtDateTime(take.recorded_at, i18n.locale)}</span>
					<ExternalLinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
				</a>
				<p class="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
					<VoiceMark intent={take.intent} class="text-foreground" />
					<span class="truncate">
						{i18n.t.intent[take.intent]} · {what}{#if passage}
							· {passage.title}{/if}
					</span>
				</p>
			</div>

			<div class="flex min-w-48 flex-1 items-center gap-2">
				<span
					class="w-9 text-right text-xs text-muted-foreground tabular-nums"
					data-testid="dock-position"
				>
					{fmtDuration(player.position)}
				</span>
				<div
					bind:this={bar}
					bind:clientWidth={width}
					class="relative flex-1 cursor-pointer touch-none overflow-hidden rounded-md bg-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
					style:height="{HEIGHT}px"
					role="slider"
					tabindex="0"
					aria-label={i18n.t.dock.seek}
					aria-valuemin={0}
					aria-valuemax={Math.round(length)}
					aria-valuenow={Math.round(player.position)}
					aria-valuetext={fmtDuration(player.position)}
					onpointerdown={(event) => {
						dragging = true;
						event.currentTarget.setPointerCapture(event.pointerId);
						seekTo(event);
					}}
					onpointermove={(event) => dragging && seekTo(event)}
					onpointerup={() => (dragging = false)}
					onpointercancel={() => (dragging = false)}
					onkeydown={(event) => {
						if (event.key === 'ArrowLeft') player.seek(player.position - 2);
						else if (event.key === 'ArrowRight') player.seek(player.position + 2);
						else if (event.key === 'Home') player.seek(0);
						else if (event.key === 'End') player.seek(length);
						else return;
						event.preventDefault();
					}}
					data-testid="dock-seek"
					data-contour={contour !== null}
				>
					{#if contour}
						<svg {width} height={HEIGHT} class="absolute inset-0 block" aria-hidden="true">
							<path d={contour.shape} class="fill-foreground/12" />
							<path d={contour.line} class="fill-none stroke-series-1" stroke-width="1.5" />
						</svg>
					{/if}
					<div class="absolute inset-y-0 left-0 bg-primary/15" style:width="{played}px"></div>
					<div class="absolute inset-y-0 w-0.5 bg-primary" style:left="{played}px"></div>
				</div>
				<span class="w-9 text-xs text-muted-foreground tabular-nums">{fmtDuration(length)}</span>
			</div>

			<div class="flex items-center gap-1">
				{#if player.queue.length > 1}
					<span class="px-1 text-xs text-muted-foreground tabular-nums" data-testid="dock-place">
						{i18n.t.dock.place(player.index + 1, player.queue.length)}
					</span>
				{/if}
				<select
					class="select h-7 w-16 rounded-md px-1 text-xs"
					aria-label={i18n.t.dock.speed}
					title={i18n.t.dock.speed}
					value={player.rate}
					onchange={(event) => player.setRate(Number(event.currentTarget.value))}
					data-testid="dock-speed"
				>
					{#each RATES as rate (rate)}
						<option value={rate}>{rate}×</option>
					{/each}
				</select>
				<Button
					size="icon-sm"
					variant={player.loop ? 'secondary' : 'ghost'}
					aria-pressed={player.loop}
					aria-label={i18n.t.dock.loop}
					title={i18n.t.dock.loop}
					onclick={() => player.setLoop(!player.loop)}
					data-testid="dock-loop"
				>
					<RepeatIcon />
				</Button>
				<Button
					size="icon-sm"
					variant={player.onward ? 'secondary' : 'ghost'}
					aria-pressed={player.onward}
					aria-label={i18n.t.dock.onward}
					title={i18n.t.dock.onward}
					onclick={() => player.setOnward(!player.onward)}
					data-testid="dock-onward"
				>
					<ListEndIcon />
				</Button>
				<Help title={i18n.t.dock.label} text={i18n.t.dock.help} align="end">
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
						{#each i18n.t.dock.keys as [key, does] (key)}
							<dt>
								<kbd class={cn('rounded border bg-muted px-1.5 font-mono text-xs')}>{key}</kbd>
							</dt>
							<dd class="text-muted-foreground">{does}</dd>
						{/each}
					</dl>
				</Help>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label={i18n.t.dock.close}
					title={i18n.t.dock.close}
					onclick={() => player.close()}
					data-testid="dock-close"
				>
					<XIcon />
				</Button>
			</div>

			{#if player.problem}
				<p
					class={cn(
						'basis-full text-xs',
						player.problem === 'failed' ? 'text-critical' : 'text-muted-foreground'
					)}
					role={player.problem === 'failed' ? 'alert' : undefined}
					data-testid="dock-problem"
					data-problem={player.problem}
				>
					{i18n.t.dock.problems[player.problem]}
				</p>
			{/if}
		</div>
	</aside>
{/if}
