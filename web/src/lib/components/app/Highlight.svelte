<script lang="ts">
	// A text with the words of a search marked in it. Text nodes and <mark>,
	// never markup from the text itself.
	import { highlightParts } from '#lib/highlight.js';

	let { text, words }: { text: string; words: readonly string[] } = $props();

	const parts = $derived(highlightParts(text, words));
</script>

{#each parts as part, index (index)}{#if part.hit}<mark class="rounded-xs bg-highlight text-inherit"
			>{part.text}</mark
		>{:else}{part.text}{/if}{/each}
