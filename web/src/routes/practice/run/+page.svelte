<script lang="ts">
	// A guided session: check-in, then each exercise's reps (record, rate
	// the comfort before any number is shown, then the result), then a
	// check-out. The session and every take go through the upload queue, so
	// nothing is lost when the API is away; results arrive when they can.
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SquareIcon from '@lucide/svelte/icons/square';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import { fetchTake } from '#lib/api/index.js';
	import type { Feel, TakeMeta, TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { CaptureError, Recorder, type Recording } from '#lib/audio/capture.js';
	import { playShape, playTone, shapeOf } from '#lib/audio/tone.js';
	import LiveScope from '#lib/components/audio/LiveScope.svelte';
	import TakePlayer from '#lib/components/audio/TakePlayer.svelte';
	import BandCard from '#lib/components/app/BandCard.svelte';
	import BandStrip from '#lib/components/app/BandStrip.svelte';
	import ComfortPicker from '#lib/components/app/ComfortPicker.svelte';
	import EvaluationView from '#lib/components/app/EvaluationView.svelte';
	import ExerciseDetails from '#lib/components/app/ExerciseDetails.svelte';
	import Meter from '#lib/components/app/Meter.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { fmtDuration } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { exerciseRef, routineRef } from '#lib/labels.js';
	import { noteName, pickNote } from '#lib/practice/notes.js';
	import {
		advance,
		begin,
		planSteps,
		practiceBody,
		strained,
		upcoming,
		type RunEvent,
		type RunState
	} from '#lib/practice/runner.js';
	import { newId, queue, type Outcome } from '#lib/queue.svelte.js';

	const DEVICE_KEY = 'puptrainer.device';
	const INPUT_KEY = 'puptrainer.input';
	const POLL_MS = 1_500;
	const SPOKEN = new Set(['phrase', 'passage', 'free', 'other']);
	const FEELS: Feel[] = ['fresh', 'normal', 'tired', 'hoarse'];

	const routine = $derived(app.routine(page.url.searchParams.get('routine')));
	const single = $derived(app.exercise(page.url.searchParams.get('exercise')));

	let run = $state.raw<RunState | null>(null);
	const practiceId = newId();
	let startedAt = $state<Date | null>(null);
	let language = $state<string>(i18n.locale);
	let hoarse = $state(false);

	let deviceId = $state<number | null>(
		browser ? Number(localStorage.getItem(DEVICE_KEY)) || null : null
	);
	const inputId = browser ? (localStorage.getItem(INPUT_KEY) ?? '') : '';
	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);

	let pitchHz = $state<number | null>(null);
	let peakDb = $state(-120);
	let clipping = $state(false);
	let seconds = $state(0);
	let recording = $state.raw<Recording | null>(null);
	let listening = $state(false);
	let problem = $state<string | null>(null);

	/** The note of the current note-matching rep, keyed by step and rep. */
	let note = $state<{ key: string; hz: number } | null>(null);
	let lastNote: number | null = null;
	let playing = $state(false);
	let scope = $state<LiveScope | null>(null);

	let waitingFor = $state<string | null>(null);
	let outcome = $state<Outcome | null>(null);
	let result = $state.raw<TakeOut | null>(null);
	/** Whether each rep met its rule, by client id, as far as known. */
	let verdicts = $state<Record<string, boolean | null>>({});

	let comfortEnd = $state<number | null>(null);
	let lastingTension = $state<boolean | null>(null);
	let sessionNote = $state('');

	const recorder = new Recorder((frame) => {
		peakDb = frame.peakDb;
		if (frame.clipped) clipping = true;
		pitchHz = frame.pitchHz;
		seconds = frame.seconds;
		scope?.push(frame.samples, frame.sampleRate);
	});

	$effect(() => {
		if (run === null && app.content) run = begin(planSteps(app.content.exercises, routine, single));
	});

	const step = $derived(run && run.phase !== 'done' ? (run.steps[run.step] ?? null) : null);
	const exercise = $derived(step?.exercise ?? null);
	const repKey = $derived(run ? `${run.step}:${run.rep}` : '');
	const needsNote = $derived(exercise?.rule.kind === 'pitch_hold' && exercise.rule.at === 'note');
	const text = $derived(app.passage(exercise?.texts[language]));
	const band = $derived(app.band);

	// a new note for every note-matching rep
	$effect(() => {
		if (!needsNote || !band || note?.key === repKey) return;
		const hz = pickNote(band.low_hz, band.high_hz, lastNote);
		lastNote = hz;
		note = { key: repKey, hz };
	});

	onMount(() =>
		queue.onUploaded((take) => {
			if (take.client_id && take.client_id === waitingFor) result = take;
		})
	);

	onDestroy(() => recorder.cancel());

	// results take a few seconds: poll the take until it is judged
	$effect(() => {
		const take = result;
		if (!take || take.evaluation?.problem !== 'not-analysed') return;
		if (take.analysis?.status === 'failed') return;
		const timer = setInterval(async () => {
			try {
				const next = await fetchTake(take.id);
				if (next.id === result?.id) result = next;
			} catch {
				// NOTE: offline for a moment; the next tick tries again
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const take = result;
		if (take?.client_id && take.evaluation && take.evaluation.problem !== 'not-analysed')
			verdicts[take.client_id] = take.evaluation.met;
	});

	function send(event: RunEvent) {
		if (run) run = advance(run, event);
	}

	async function writeSession(end: boolean) {
		if (!run || !startedAt) return;
		await queue.putPractice(
			practiceId,
			practiceBody(run, {
				routineRef: routine ? routineRef(routine) : null,
				language,
				startedAt,
				endedAt: end ? new Date() : null,
				comfortEnd: end ? comfortEnd : null,
				lastingTension: end ? lastingTension : null,
				note: end ? sessionNote : ''
			})
		);
	}

	function checkIn(feel: Feel | null) {
		if (feel === 'hoarse' && !hoarse) {
			hoarse = true;
			return;
		}
		startedAt = new Date();
		send({ type: 'checkin', feel });
		void writeSession(false);
	}

	async function restToday() {
		startedAt = new Date();
		send({ type: 'checkin', feel: 'hoarse' });
		send({ type: 'end' });
		await finish();
	}

	function clearRep() {
		listening = false;
		recording = null;
		result = null;
		waitingFor = null;
		outcome = null;
		problem = null;
	}

	async function start() {
		clearRep();
		peakDb = -120;
		clipping = false;
		pitchHz = null;
		seconds = 0;
		try {
			await recorder.start(inputId || undefined);
			send({ type: 'start' });
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
			send({ type: 'stop' });
		} catch (e) {
			problem = i18n.t.record.failed(e instanceof Error ? e.message : String(e));
			send({ type: 'cancel' });
		}
	}

	function cancel() {
		recorder.cancel();
		clearRep();
		send({ type: 'cancel' });
	}

	async function rate(comfort: number | null) {
		if (!run || !recording || !exercise || !device) return;
		const clientId = newId();
		const stamp = new Date();
		const spoken = SPOKEN.has(exercise.item);
		const meta: TakeMeta = {
			device_id: device.id,
			item: exercise.item,
			intent: exercise.intent,
			language: spoken ? language : null,
			content_ref: spoken ? (exercise.texts[language] ?? null) : null,
			recorded_at: stamp.toISOString(),
			note: '',
			client_id: clientId,
			session_id: practiceId,
			exercise_ref: exerciseRef(exercise),
			target: band
				? {
						band_low_hz: band.low_hz,
						band_high_hz: band.high_hz,
						note_hz: needsNote && note ? note.hz : null
					}
				: null,
			comfort
		};
		const name = `${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}_${exercise.id}.wav`;
		const wav = recording.wav;
		waitingFor = clientId;
		send({ type: 'rate', comfort, clientId });
		verdicts[clientId] = null;
		outcome = await queue.add(wav, 'audio/wav', name, meta);
	}

	async function playNote() {
		if (!note || playing) return;
		playing = true;
		try {
			await playTone(note.hz);
		} finally {
			playing = false;
		}
	}

	/** Plays the exercise's pitch pattern as a tone, placed around the band. */
	async function playDemo() {
		const shape = exercise && band ? shapeOf(exercise.demo, band.low_hz, band.high_hz) : null;
		if (!shape || playing) return;
		playing = true;
		try {
			await playShape(shape);
		} finally {
			playing = false;
		}
	}

	function next(event: RunEvent) {
		clearRep();
		send(event);
	}

	/** Ends the session; the summary shows once the session is stored on the device. */
	async function finish() {
		await writeSession(true);
		send({ type: 'finish' });
	}

	const metCount = $derived(Object.values(verdicts).filter((v) => v === true).length);
</script>

<div class="mx-auto max-w-2xl">
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<h1 class="text-2xl">
			{i18n.pick(routine?.titles) || i18n.pick(single?.titles) || i18n.t.practice.title}
		</h1>
		{#if run && step && run.phase !== 'checkin'}
			<span class="text-sm text-muted-foreground" data-testid="position">
				{i18n.t.practice.run.step(run.step + 1, run.steps.length)} ·
				{i18n.t.practice.run.rep(run.rep, step.reps)}
			</span>
		{/if}
	</div>

	{#if !app.loaded || run === null}
		<p class="text-muted-foreground">{i18n.t.common.loading}</p>
	{:else if run.steps.length === 0}
		<p class="text-muted-foreground">{i18n.t.practice.logEmpty}</p>
		<Button class="mt-3" href="/practice">{i18n.t.practice.run.back}</Button>
	{:else if !device}
		<p class="text-muted-foreground">{i18n.t.practice.needDevice}</p>
		<Button class="mt-3" href="/devices">{i18n.t.record.addDevice}</Button>
	{:else if !band}
		<p class="mb-3 text-sm">{i18n.t.practice.needBand}</p>
		<BandCard />
	{:else if run.phase === 'checkin'}
		<section class="panel space-y-4" data-testid="checkin">
			<div class="flex flex-wrap gap-4">
				<label class="block text-sm">
					<span class="mb-1 block text-muted-foreground">{i18n.t.practice.run.language}</span>
					<select class="select" bind:value={language} data-testid="session-language">
						<option value="en">{i18n.language('en')}</option>
						<option value="cs">{i18n.language('cs')}</option>
					</select>
				</label>
				<label class="block text-sm">
					<span class="mb-1 block text-muted-foreground">{i18n.t.record.setup}</span>
					<select
						class="select"
						value={device.id}
						onchange={(event) => {
							deviceId = Number(event.currentTarget.value);
							localStorage.setItem(DEVICE_KEY, String(deviceId));
						}}
					>
						{#each app.devices as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</select>
				</label>
			</div>
			<div>
				<h2 class="mb-2 text-base">{i18n.t.practice.run.checkin}</h2>
				<div class="flex flex-wrap gap-2">
					{#each FEELS as feel (feel)}
						<Button
							variant="outline"
							class="rounded-full"
							onclick={() => checkIn(feel)}
							data-testid="feel-{feel}"
						>
							{i18n.t.practice.run.feel[feel]}
						</Button>
					{/each}
					<Button variant="ghost" class="rounded-full" onclick={() => checkIn(null)}>
						{i18n.t.practice.run.skip}
					</Button>
				</div>
				{#if hoarse}
					<div class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
						<p>{i18n.t.practice.run.hoarse}</p>
						<div class="mt-2 flex flex-wrap gap-2">
							<Button size="sm" onclick={restToday} data-testid="rest">
								{i18n.t.practice.run.rest}
							</Button>
							<Button size="sm" variant="outline" onclick={() => checkIn('hoarse')}>
								{i18n.t.practice.run.gently}
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</section>
	{:else if exercise && (run.phase === 'intro' || run.phase === 'recording' || run.phase === 'rating' || run.phase === 'result')}
		<section class="panel space-y-3" data-testid="step" data-exercise={exercise.id}>
			<h2 class="text-lg">{i18n.pick(exercise.titles)}</h2>

			{#if run.phase === 'intro'}
				<ExerciseDetails {exercise} />
			{:else if run.phase === 'recording'}
				<ExerciseDetails {exercise} brief />
			{/if}

			{#if text && run.phase !== 'result'}
				<blockquote
					class="rounded-lg border border-primary/25 bg-card px-4 py-3 text-lg leading-relaxed whitespace-pre-line"
					lang={text.language}
					data-testid="text"
				>
					{text.text}
				</blockquote>
			{/if}

			{#if needsNote && note && (run.phase === 'intro' || run.phase === 'recording')}
				<div class="flex flex-wrap items-center gap-3">
					<Button
						variant="outline"
						disabled={playing || run.phase === 'recording'}
						onclick={playNote}
						data-testid="play-note"
					>
						<Volume2Icon class="size-4" />
						{i18n.t.practice.run.playNote}
					</Button>
					<span class="font-semibold" data-testid="note">
						{i18n.t.practice.run.yourNote(`${noteName(note.hz)}, ${Math.round(note.hz)} Hz`)}
					</span>
				</div>
			{/if}

			{#if problem}
				<p
					class="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
					role="alert"
				>
					{problem}
				</p>
			{/if}

			{#if run.phase === 'intro' && exercise.demo !== 'none'}
				<div class="flex flex-wrap items-center gap-3">
					<Button variant="outline" disabled={playing} onclick={playDemo} data-testid="play-demo">
						<Volume2Icon class="size-4" />
						{i18n.t.practice.run.demo}
					</Button>
					<span class="text-xs text-muted-foreground">{i18n.t.practice.run.demoHint}</span>
				</div>
			{/if}

			{#if run.phase === 'intro'}
				<div class="flex flex-wrap gap-2">
					<Button
						size="lg"
						class="rounded-full px-6"
						disabled={playing}
						onclick={start}
						data-testid="record"
					>
						<MicIcon class="size-5" />
						{i18n.t.practice.run.record}
					</Button>
					<Button variant="ghost" onclick={() => next({ type: 'skip' })} data-testid="skip-step">
						{i18n.t.practice.run.skipStep}
					</Button>
					<Button variant="ghost" onclick={() => next({ type: 'end' })} data-testid="end">
						{i18n.t.practice.run.end}
					</Button>
				</div>
			{:else if run.phase === 'recording'}
				<div class="flex flex-wrap items-center gap-4">
					<Button
						size="lg"
						variant="destructive"
						class="rounded-full px-6"
						onclick={stop}
						data-testid="stop"
					>
						<SquareIcon class="size-4 fill-current" />
						{i18n.t.practice.run.stop}
					</Button>
					<span class="flex items-center gap-2 text-sm">
						<span class="size-2.5 animate-pulse rounded-full bg-critical"></span>
						<span class="font-mono tabular-nums">{fmtDuration(seconds)}</span>
					</span>
					<Button variant="ghost" onclick={cancel}>{i18n.t.common.discard}</Button>
				</div>
				{#if exercise.live === 'pitch'}
					<BandStrip
						low={band.low_hz}
						high={band.high_hz}
						pitch={pitchHz}
						note={needsNote && note ? note.hz : null}
					/>
				{:else if exercise.live === 'formants'}
					<LiveScope bind:this={scope} fixed="formants" />
				{/if}
				<Meter {peakDb} {clipping} />
			{:else if run.phase === 'rating'}
				<div data-testid="rating">
					<h3 class="mb-2 font-semibold">{i18n.t.practice.run.comfort}</h3>
					<ComfortPicker onpick={(comfort) => void rate(comfort)} />
					<div class="mt-3 flex flex-wrap items-center gap-2">
						<Button variant="ghost" size="sm" onclick={() => void rate(null)}>
							{i18n.t.practice.run.skip}
						</Button>
						{#if !listening}
							<Button
								variant="outline"
								size="sm"
								onclick={() => (listening = true)}
								data-testid="listen"
							>
								<Volume2Icon class="size-4" />
								{i18n.t.practice.run.listen}
							</Button>
						{/if}
						<Button variant="ghost" size="sm" onclick={cancel} data-testid="discard">
							{i18n.t.common.discard}
						</Button>
					</div>
					{#if listening && recording}
						<div class="mt-3">
							<TakePlayer source={recording.wav} name="{exercise.id}.wav" />
						</div>
					{/if}
				</div>
			{:else if run.phase === 'result'}
				<div data-testid="result">
					{#if result?.evaluation && result.evaluation.problem !== 'not-analysed'}
						<EvaluationView evaluation={result.evaluation} />
					{:else if outcome === 'waiting' || outcome === 'rejected'}
						<p class="text-sm text-muted-foreground" data-testid="result-offline">
							{outcome === 'rejected' ? i18n.t.queue.rejected : i18n.t.practice.run.offline}
						</p>
					{:else}
						<p class="text-sm text-muted-foreground" data-testid="measuring">
							{i18n.t.practice.run.measuring}
						</p>
					{/if}

					{#if strained(run)}
						<div
							class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
							data-testid="strained"
						>
							<p>{i18n.t.practice.run.strained}</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<Button size="sm" onclick={() => next({ type: 'end' })}>
									{i18n.t.practice.run.end}
								</Button>
								<Button size="sm" variant="outline" onclick={() => next({ type: 'skip' })}>
									{i18n.t.practice.run.strainedNext}
								</Button>
								{#if upcoming(run) === 'rep'}
									<Button size="sm" variant="ghost" onclick={() => next({ type: 'next' })}>
										{i18n.t.practice.run.strainedRetry}
									</Button>
								{/if}
							</div>
						</div>
					{:else}
						{#if run.reps.at(-1)?.comfort === 2}
							<p class="mt-2 text-sm text-muted-foreground">{i18n.t.practice.run.effortful}</p>
						{/if}
						<div class="mt-3 flex flex-wrap gap-2">
							<Button onclick={() => next({ type: 'next' })} data-testid="next">
								{#if upcoming(run) === 'rep'}
									{i18n.t.practice.run.next}
								{:else if upcoming(run) === 'step'}
									{i18n.t.practice.run.nextStep(i18n.pick(run.steps[run.step + 1].exercise.titles))}
								{:else}
									{i18n.t.practice.run.toCheckout}
								{/if}
							</Button>
							{#if upcoming(run) === 'rep'}
								<Button variant="ghost" onclick={() => next({ type: 'skip' })}>
									{i18n.t.practice.run.skipStep}
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{:else if run.phase === 'checkout'}
		<section class="panel space-y-4" data-testid="checkout">
			<div>
				<h2 class="mb-2 text-base">{i18n.t.practice.run.checkout}</h2>
				<ComfortPicker value={comfortEnd} onpick={(c) => (comfortEnd = c)} />
			</div>
			<div>
				<p class="mb-2 text-sm">{i18n.t.practice.run.tension}</p>
				<div class="flex gap-2">
					{#each [true, false] as answer (answer)}
						<Button
							variant={lastingTension === answer ? 'default' : 'outline'}
							size="sm"
							class="rounded-full"
							onclick={() => (lastingTension = answer)}
							data-testid="tension-{answer ? 'yes' : 'no'}"
						>
							{answer ? i18n.t.practice.run.yes : i18n.t.practice.run.no}
						</Button>
					{/each}
				</div>
				{#if lastingTension}
					<p class="mt-2 text-sm text-warning">{i18n.t.practice.run.tensionAdvice}</p>
				{/if}
			</div>
			<label class="block text-sm">
				<span class="mb-1 block text-muted-foreground">{i18n.t.practice.run.note}</span>
				<Textarea bind:value={sessionNote} rows={2} />
			</label>
			<Button onclick={finish} data-testid="finish">{i18n.t.practice.run.finish}</Button>
		</section>
	{:else if run.phase === 'done'}
		<section class="panel space-y-3" data-testid="done">
			<p class="text-lg font-bold">{i18n.t.practice.run.done}</p>
			{#if run.reps.length}
				<p class="text-sm" data-testid="summary">
					{i18n.t.practice.run.summary(run.reps.length, metCount)}
				</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				{#if startedAt}
					<Button href="/practice/sessions/{practiceId}">{i18n.t.practice.run.toLog}</Button>
				{/if}
				<Button variant="outline" href="/practice">{i18n.t.practice.run.back}</Button>
			</div>
		</section>
	{/if}
</div>
