<script lang="ts">
	// A take to listen to and to look at: the player, and under it the take
	// moment by moment on the same time axis, with the playback position
	// running through both. A click on a moment of either plays from there.
	import type { Trace } from '#lib/api/types.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import TakePlayer from './TakePlayer.svelte';
	import Traces from './Traces.svelte';

	let {
		source,
		name = 'take',
		trace = null,
		band,
		labels = [],
		live = false
	}: {
		/** Where the recording is (a URL), or the recording itself. */
		source: string | ArrayBuffer;
		/** File name offered for the download. */
		name?: string;
		/** The take moment by moment; nothing is drawn without it. */
		trace?: Trace | null;
		/** The pitch band to shade in the pitch row. */
		band?: readonly [number, number];
		/** Names of the take's held sounds, in order. */
		labels?: string[];
		/** The rows come from the live guide, not from the analysis. */
		live?: boolean;
	} = $props();

	let player = $state<TakePlayer | null>(null);
	let position = $state(0);
	let duration = $state(0);
</script>

<div class="space-y-3" data-testid="take-review">
	<TakePlayer bind:this={player} bind:position bind:duration {source} {name} />
	{#if trace && trace.rows.length}
		<Traces
			heading={i18n.t.traces.title}
			{trace}
			{duration}
			{position}
			onseek={(seconds) => player?.seek(seconds)}
			{band}
			{labels}
			{live}
		/>
	{/if}
</div>
