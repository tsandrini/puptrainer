<script lang="ts">
	// An empty state: a paw, a line of text, and what to do next.
	import type { Snippet } from 'svelte';
	import Paw from './Paw.svelte';

	let { text, children }: { text: string; children?: Snippet } = $props();
</script>

<div class="rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center">
	<Paw class="mx-auto size-10 text-primary/35" />
	<p class="mx-auto mt-3 max-w-md text-muted-foreground">{text}</p>
	{#if children}
		<div class="mt-4 flex flex-wrap justify-center gap-2">{@render children()}</div>
	{/if}
</div>
