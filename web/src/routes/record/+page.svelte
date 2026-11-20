<script lang="ts">
	// Recording: pick the microphone setup, what to record and which voice
	// it is; watch the level, the live pitch, the live resonance against the
	// everyday voice and a live spectrogram while speaking; listen back, then
	// save. A saved take goes through the upload queue, so it is never lost
	// when the API is away.
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/env';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { fetchTakes } from '#lib/api/index.js';
	import type { Intent, Item, ProtocolItem, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { CaptureError, Recorder, listInputs, type Recording } from '#lib/audio/capture.js';
	import { TARGET_DB } from '#lib/audio/meter.js';
	import { liveReference, type LiveReference } from '#lib/audio/reference.js';
	import LiveResonance, { type Zero } from '#lib/components/audio/LiveResonance.svelte';
	import LiveScope from '#lib/components/audio/LiveScope.svelte';
	import TakePlayer from '#lib/components/audio/TakePlayer.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import Meter from '#lib/components/app/Meter.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { fmtDuration, fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { passageRef } from '#lib/labels.js';
	import { queue, type Outcome } from '#lib/queue.svelte.js';
	import { cn } from '#lib/utils.js';

	const DEVICE_KEY = 'puptrainer.device';
	const INPUT_KEY = 'puptrainer.input';
	const INTENT_KEY = 'puptrainer.intent';
	/** Free choices next to the protocol's steps. */
	const extra: Item[] = ['vowels', 'glide', 'free', 'other'];

	/** Kinds of take whose resonance can be followed live. */
	const RESONANT: Item[] = ['vowels', 'phrase', 'passage', 'free', 'other'];

	type Choice = {
		key: string;
		label: string;
		item: Item;
		step: ProtocolItem | null;
		language: string | null;
		contentRef: string | null;
	};

	let deviceId = $state<number | null>(
		browser ? Number(localStorage.getItem(DEVICE_KEY)) || null : null
	);
	let inputId = $state(browser ? (localStorage.getItem(INPUT_KEY) ?? '') : '');
	let intent = $state<Intent>(
		browser && localStorage.getItem(INTENT_KEY) === 'attempt' ? 'attempt' : 'habitual'
	);
	let choiceKey = $state('');
	let note = $state('');
	let inputs = $state.raw<MediaDeviceInfo[]>([]);
	let today = $state.raw<TakeOut[]>([]);
	/** Phrases already recorded in the everyday voice: the exercise texts among them. */
	let phrases = $state.raw<TakeOut[]>([]);

	let phase = $state<'idle' | 'recording' | 'review'>('idle');
	let peakDb = $state(-120);
	let heldPeakDb = $state(-120);
	let clipping = $state(false);
	let pitchHz = $state<number | null>(null);
	let seconds = $state(0);
	let recording = $state.raw<Recording | null>(null);
	let scope = $state<LiveScope | null>(null);
	let meter = $state<LiveResonance | null>(null);
	/** The everyday voice the live resonance counts from; undefined while it is measured. */
	let everyday = $state.raw<LiveReference | null | undefined>(undefined);
	let problem = $state<string | null>(null);
	let outcome = $state<Outcome | null>(null);

	const recorder = new Recorder((frame) => {
		peakDb = frame.peakDb;
		heldPeakDb = Math.max(heldPeakDb, frame.peakDb);
		if (frame.clipped) clipping = true;
		pitchHz = frame.pitchHz;
		seconds = frame.seconds;
		scope?.push(frame.samples, frame.sampleRate);
		meter?.push(frame.samples, frame.sampleRate, frame.pitchHz);
	});

	const baseline = $derived(app.content?.protocols.find((p) => p.id === 'baseline') ?? null);
	/** The texts of the exercises: read once in the everyday voice, they can be compared too. */
	const texts = $derived(
		(app.content?.passages ?? [])
			.filter((p) => !baseline?.items.some((step) => step.content_ref === passageRef(p)))
			// the interface language's texts come first
			.sort((a, b) => Number(a.language !== i18n.locale) - Number(b.language !== i18n.locale))
	);
	const choices = $derived<Choice[]>([
		...(baseline?.items ?? []).map((step) => ({
			key: `baseline:${step.key}`,
			label: i18n.pick(step.titles),
			item: step.item,
			step,
			language: step.language ?? null,
			contentRef: step.content_ref ?? null
		})),
		...texts.map((text) => ({
			key: `text:${text.id}`,
			label: `${text.title} (${i18n.language(text.language)})`,
			item: 'phrase' as const,
			step: null,
			language: text.language,
			contentRef: passageRef(text)
		})),
		...extra.map((item) => ({
			key: `item:${item}`,
			label: i18n.t.item[item],
			item,
			step: null,
			language: null,
			contentRef: null
		}))
	]);
	const choice = $derived(choices.find((c) => c.key === choiceKey) ?? choices[0] ?? null);
	const passage = $derived(app.passage(choice?.contentRef));
	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);
	/** Sustained vowels are read against their own start; speech against the everyday takes. */
	const zero = $derived<Zero | null>(
		!choice || !RESONANT.includes(choice.item)
			? null
			: choice.item === 'vowels'
				? { from: 'start' }
				: { from: 'everyday', reference: everyday }
	);

	// the everyday voice for the live meter follows what is about to be recorded
	$effect(() => {
		const [setup, what] = [device, choice];
		everyday = undefined;
		if (!setup || !what || what.item === 'vowels' || !RESONANT.includes(what.item)) return;
		let current = true;
		liveReference({
			device_id: setup.id,
			item: what.item,
			language: what.language,
			content_ref: what.contentRef
		})
			.then((reference) => current && (everyday = reference))
			.catch(() => current && (everyday = null));
		return () => {
			current = false;
		};
	});

	/** The baseline steps already recorded today in this voice on this setup. */
	const doneToday = $derived(
		new Set(
			(baseline?.items ?? [])
				.filter((step) =>
					today.some(
						(t) =>
							t.device_id === device?.id &&
							t.intent === intent &&
							t.item === step.item &&
							(t.language ?? null) === (step.language ?? null)
					)
				)
				.map((step) => step.key)
		)
	);

	async function refreshInputs() {
		inputs = await listInputs();
	}

	async function refreshToday() {
		const now = new Date();
		const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		try {
			today = (await fetchTakes()).filter((t) => Date.parse(t.recorded_at) >= midnight);
			phrases = await fetchTakes({ item: 'phrase', intent: 'habitual' });
		} catch {
			// NOTE: without the API the strips simply show nothing as done
		}
	}

	/** How many everyday lab takes of a text there are on this setup. */
	const everydayTakes = (ref: string) =>
		phrases.filter(
			(t) => t.device_id === device?.id && t.exercise_ref === null && t.content_ref === ref
		).length;

	onMount(() => {
		void refreshInputs();
		void refreshToday();
		const stop = queue.onUploaded(() => void refreshToday());
		navigator.mediaDevices?.addEventListener('devicechange', refreshInputs);
		return () => {
			stop();
			navigator.mediaDevices?.removeEventListener('devicechange', refreshInputs);
		};
	});

	onDestroy(() => recorder.cancel());

	function clearReview() {
		recording = null;
	}

	async function start() {
		problem = null;
		outcome = null;
		clearReview();
		peakDb = heldPeakDb = -120;
		clipping = false;
		pitchHz = null;
		seconds = 0;
		try {
			await recorder.start(inputId || undefined);
			phase = 'recording';
			// NOTE: the browser names the inputs only once it may use one
			void refreshInputs();
		} catch (e) {
			const kind = e instanceof CaptureError ? e.problem : 'failed';
			problem =
				kind === 'denied'
					? i18n.t.record.denied
					: kind === 'no-microphone'
						? i18n.t.record.noMic
						: kind === 'insecure'
							? i18n.t.record.insecure
							: i18n.t.record.failed(e instanceof Error ? e.message : String(e));
		}
	}

	async function stop() {
		try {
			recording = await recorder.stop();
			phase = 'review';
		} catch (e) {
			problem = i18n.t.record.failed(e instanceof Error ? e.message : String(e));
			phase = 'idle';
		}
	}

	async function save() {
		if (!recording || !device || !choice) return;
		const stamp = new Date();
		const name = `${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}_${choice.step?.key ?? choice.item}_${intent}.wav`;
		outcome = await queue.add(recording.wav, 'audio/wav', name, {
			device_id: device.id,
			item: choice.item,
			intent,
			language: choice.language,
			content_ref: choice.contentRef,
			recorded_at: stamp.toISOString(),
			note
		});
		note = '';
		clearReview();
		phase = 'idle';
	}

	function discard() {
		clearReview();
		phase = 'idle';
	}

	$effect(() => {
		if (!browser) return;
		if (device) localStorage.setItem(DEVICE_KEY, String(device.id));
		localStorage.setItem(INPUT_KEY, inputId);
		localStorage.setItem(INTENT_KEY, intent);
	});
</script>

<h1 class="mb-4 text-2xl">{i18n.t.record.title}</h1>

{#if !app.loaded}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if app.devices.length === 0}
	<Empty text={i18n.t.record.needDevice}>
		<Button href="/devices">{i18n.t.record.addDevice}</Button>
	</Empty>
{:else}
	{#if baseline}
		<section class="panel mb-4" data-testid="baseline">
			<div class="mb-2 flex items-baseline justify-between gap-2">
				<h2 class="text-base">{i18n.t.record.baseline}</h2>
				<span class="text-xs text-muted-foreground">
					{i18n.t.record.baselineToday(doneToday.size, baseline.items.length)}
				</span>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each baseline.items as step (step.key)}
					{@const done = doneToday.has(step.key)}
					<button
						type="button"
						disabled={phase !== 'idle'}
						class={cn(
							'flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold transition-colors',
							choice?.key === `baseline:${step.key}`
								? 'border-primary bg-primary text-primary-foreground'
								: 'bg-card hover:bg-accent',
							done && choice?.key !== `baseline:${step.key}` && 'text-muted-foreground'
						)}
						title={done ? i18n.t.record.recordedToday : undefined}
						data-step={step.key}
						data-done={done}
						onclick={() => (choiceKey = `baseline:${step.key}`)}
					>
						{#if done}<CheckIcon class="size-3.5" />{/if}
						{i18n.pick(step.titles)}
					</button>
				{/each}
			</div>
			{#if texts.length}
				<div class="mt-4 mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
					<h2 class="text-base">{i18n.t.record.texts}</h2>
					<span class="text-xs text-muted-foreground">{i18n.t.record.textsHint}</span>
				</div>
				<div class="flex flex-wrap gap-1.5" data-testid="texts">
					{#each texts as text (text.id)}
						{@const taken = everydayTakes(passageRef(text))}
						<button
							type="button"
							disabled={phase !== 'idle'}
							class={cn(
								'flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold transition-colors',
								choice?.key === `text:${text.id}`
									? 'border-primary bg-primary text-primary-foreground'
									: 'bg-card hover:bg-accent',
								taken > 0 && choice?.key !== `text:${text.id}` && 'text-muted-foreground'
							)}
							title={taken ? i18n.t.record.textTaken(taken) : undefined}
							data-text={text.id}
							data-taken={taken}
							onclick={() => (choiceKey = `text:${text.id}`)}
						>
							{#if taken}<CheckIcon class="size-3.5" />{/if}
							{text.title} ({i18n.language(text.language)})
						</button>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<div class="panel grid gap-3 sm:grid-cols-2">
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.record.setup}</span>
			<select
				class="select w-full"
				disabled={phase !== 'idle'}
				value={device?.id}
				onchange={(event) => (deviceId = Number(event.currentTarget.value))}
				data-testid="device"
			>
				{#each app.devices as option (option.id)}
					<option value={option.id}>{option.name}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.record.input}</span>
			<select class="select w-full" disabled={phase !== 'idle'} bind:value={inputId}>
				<option value="">{i18n.t.record.defaultInput}</option>
				{#each inputs.filter((d) => d.deviceId && d.deviceId !== 'default') as input (input.deviceId)}
					<option value={input.deviceId}>{input.label || input.deviceId.slice(0, 8)}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.record.what}</span>
			<select
				class="select w-full"
				disabled={phase !== 'idle'}
				value={choice?.key}
				onchange={(event) => (choiceKey = event.currentTarget.value)}
				data-testid="what"
			>
				{#each choices as option (option.key)}
					<option value={option.key}>{option.label}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.intent.label}</span>
			<select
				class="select w-full"
				disabled={phase !== 'idle'}
				bind:value={intent}
				data-testid="intent"
			>
				<option value="habitual">{i18n.t.intent.habitual}</option>
				<option value="attempt">{i18n.t.intent.attempt}</option>
			</select>
			<span class="mt-1 block text-xs text-muted-foreground">
				{intent === 'habitual' ? i18n.t.intent.habitualHint : i18n.t.intent.attemptHint}
			</span>
		</label>
	</div>

	{#if choice?.step}
		<p class="mt-4 text-sm">{i18n.pick(choice.step.instructions)}</p>
	{/if}
	{#if passage}
		<blockquote
			class="panel mt-3 border-primary/25 text-lg leading-relaxed"
			lang={passage.language}
			data-testid="passage"
		>
			{passage.text}
		</blockquote>
	{/if}

	{#if problem}
		<p
			class="mt-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
			role="alert"
		>
			{problem}
		</p>
	{/if}

	<div class="panel mt-4">
		{#if phase === 'idle'}
			<Button size="lg" class="rounded-full px-6" onclick={start} data-testid="start">
				<MicIcon class="size-5" />
				{i18n.t.record.start}
			</Button>
			{#if outcome}
				<p class="mt-3 text-sm text-muted-foreground" role="status" data-testid="outcome">
					{outcome === 'uploaded'
						? i18n.t.record.saved
						: outcome === 'waiting'
							? i18n.t.record.savedOffline
							: i18n.t.queue.rejected}
				</p>
			{/if}
		{:else if phase === 'recording'}
			<div class="flex flex-wrap items-center gap-4">
				<Button
					size="lg"
					variant="destructive"
					class="rounded-full px-6"
					onclick={stop}
					data-testid="stop"
				>
					<SquareIcon class="size-4 fill-current" />
					{i18n.t.record.stop}
				</Button>
				<span class="flex items-center gap-2 text-sm">
					<span class="size-2.5 animate-pulse rounded-full bg-critical"></span>
					{i18n.t.record.recording}
					<span class="font-mono tabular-nums" data-testid="elapsed">{fmtDuration(seconds)}</span>
				</span>
				<span class="ml-auto text-sm text-muted-foreground">
					{i18n.t.record.pitch}:
					<span class="font-mono text-base text-foreground tabular-nums" data-testid="live-pitch">
						{pitchHz ? `${Math.round(pitchHz)} Hz` : i18n.t.common.none}
					</span>
				</span>
			</div>
			<div class="mt-4">
				<div class="mb-1 flex justify-between text-xs text-muted-foreground">
					<span>{i18n.t.record.level} · {i18n.t.record.target}</span>
					<span class="font-mono tabular-nums">{fmtNumber(heldPeakDb, 1, i18n.locale)} dBFS</span>
				</div>
				<Meter {peakDb} {clipping} />
				{#if clipping}
					<p class="mt-1 text-sm text-critical" data-testid="clip-warning">
						{i18n.t.record.clipping}
					</p>
				{:else if seconds > 3 && heldPeakDb < TARGET_DB.low - 8}
					<p class="mt-1 text-sm text-warning">{i18n.t.record.tooQuiet}</p>
				{/if}
			</div>
			{#if zero}
				<div class="mt-4">
					<LiveResonance bind:this={meter} {zero} />
				</div>
			{/if}
			<div class="mt-4">
				<LiveScope bind:this={scope} />
			</div>
		{:else if recording}
			<h2 class="mb-2 font-medium">{i18n.t.record.review}</h2>
			<TakePlayer source={recording.wav} name="{choice?.step?.key ?? choice?.item ?? 'take'}.wav" />
			<p class="mt-2 text-sm text-muted-foreground" data-testid="review">
				{fmtDuration(recording.seconds)} · {i18n.t.record.peak(
					fmtNumber(recording.peakDb, 1, i18n.locale)
				)} · {recording.sampleRate / 1000} kHz
			</p>
			{#if recording.clipped > 0}
				<p class="mt-1 text-sm text-critical">{i18n.t.record.clipped(recording.clipped)}</p>
			{:else if recording.peakDb < TARGET_DB.low - 8}
				<p class="mt-1 text-sm text-warning">{i18n.t.record.tooQuiet}</p>
			{/if}
			<label class="mt-3 block text-sm">
				<span class="mb-1 block text-muted-foreground">{i18n.t.take.note}</span>
				<Textarea bind:value={note} rows={2} />
			</label>
			<div class="mt-3 flex flex-wrap gap-2">
				<Button onclick={save} data-testid="save">{i18n.t.record.saveTake}</Button>
				<Button variant="outline" onclick={start}>{i18n.t.record.again}</Button>
				<Button variant="ghost" onclick={discard}>{i18n.t.common.discard}</Button>
			</div>
		{/if}
	</div>
{/if}
