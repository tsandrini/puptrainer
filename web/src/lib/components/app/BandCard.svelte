<script lang="ts">
	// The pitch band to practise in: the current one, a form to move it, a
	// common starting band, and beside it, descriptively, the learner's own
	// latest glide and everyday pitch. No band is "right"; it is a tool.
	import { onMount } from 'svelte';
	import { fetchTakes } from '#lib/api/index.js';
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { fmtNumber } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { STARTING_BAND, noteName } from '#lib/practice/notes.js';

	let { onset }: { onset?: () => void } = $props();

	let low = $state<number | null>(app.band?.low_hz ?? null);
	let high = $state<number | null>(app.band?.high_hz ?? null);
	let problem = $state<string | null>(null);
	let busy = $state(false);
	let takes = $state.raw<TakeOut[]>([]);

	const hz = (value: number) => `${fmtNumber(value, 0, i18n.locale)} Hz (${noteName(value)})`;
	const glide = $derived(
		takes.find((t) => t.item === 'glide' && t.metrics.glide_low_hz && t.metrics.glide_high_hz)
	);
	const everyday = $derived.by(() => {
		const values = takes
			.filter((t) => (t.item === 'passage' || t.item === 'free') && t.metrics.pitch_median_hz)
			.map((t) => t.metrics.pitch_median_hz)
			.sort((a, b) => a - b);
		return values.length ? values[Math.floor(values.length / 2)] : null;
	});

	onMount(async () => {
		try {
			takes = await fetchTakes({ intent: 'habitual' });
		} catch {
			// NOTE: the context is a nicety; the band can be set without it
		}
	});

	async function save(lowHz: number | null, highHz: number | null) {
		problem = null;
		if (!lowHz || !highHz || highHz < lowHz * 2 ** (1 / 12)) {
			problem = i18n.t.practice.band.invalid;
			return;
		}
		busy = true;
		try {
			await app.setBand(lowHz, highHz);
			[low, high] = [lowHz, highHz];
			onset?.();
		} catch (e) {
			problem = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="panel" data-testid="band-card">
	<h2 class="mb-1 text-base">{i18n.t.practice.band.title}</h2>
	<p class="mb-3 text-sm text-muted-foreground">{i18n.t.practice.band.intro}</p>
	<p class="mb-3 text-lg font-extrabold tabular-nums" data-testid="band">
		{#if app.band}
			{hz(app.band.low_hz)} – {hz(app.band.high_hz)}
		{:else}
			<span class="text-base font-semibold text-muted-foreground">{i18n.t.practice.band.none}</span>
		{/if}
	</p>
	<form
		class="flex flex-wrap items-end gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			void save(low, high);
		}}
	>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.practice.band.low}</span>
			<Input
				type="number"
				min="50"
				max="1000"
				class="w-28"
				bind:value={low}
				data-testid="band-low"
			/>
		</label>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.practice.band.high}</span>
			<Input
				type="number"
				min="50"
				max="1000"
				class="w-28"
				bind:value={high}
				data-testid="band-high"
			/>
		</label>
		<Button type="submit" disabled={busy} data-testid="band-set">{i18n.t.practice.band.set}</Button>
		<Button
			type="button"
			variant="outline"
			disabled={busy}
			onclick={() => save(STARTING_BAND.low_hz, STARTING_BAND.high_hz)}
			data-testid="band-starting"
		>
			{i18n.t.practice.band.starting}
		</Button>
	</form>
	{#if problem}
		<p class="mt-2 text-sm text-critical" role="alert">{problem}</p>
	{/if}
	<ul class="mt-3 space-y-0.5 text-xs text-muted-foreground">
		{#if glide}
			<li>
				{i18n.t.practice.band.glide(
					hz(glide.metrics.glide_low_hz),
					hz(glide.metrics.glide_high_hz)
				)}
			</li>
		{/if}
		{#if everyday}
			<li>{i18n.t.practice.band.everyday(hz(everyday))}</li>
		{/if}
		<li>{i18n.t.practice.band.conventions}</li>
	</ul>
</section>
