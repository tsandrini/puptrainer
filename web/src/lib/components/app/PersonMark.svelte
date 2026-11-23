<script lang="ts">
	// The mark of a person, the same on every chart, in every legend and
	// list: a circle for the default person, a triangle, a square or a pin
	// for the others.
	import type { Shape } from '#lib/people.js';
	import { cn } from '#lib/utils.js';

	let { shape, class: className }: { shape: Shape; class?: string } = $props();
</script>

<svg
	viewBox="0 0 10 10"
	class={cn('inline-block size-2.5 shrink-0', className)}
	fill="currentColor"
	aria-hidden="true"
	data-person-mark={shape}
>
	{#if shape === 'triangle'}
		<path d="M5 0.8 9.6 8.9H0.4Z" />
	{:else if shape === 'rect'}
		<rect x="1.2" y="1.2" width="7.6" height="7.6" rx="0.6" />
	{:else if shape === 'pin'}
		<path d="M5 9.8C5 9.8 1.4 6 1.4 3.8a3.6 3.6 0 1 1 7.2 0C8.6 6 5 9.8 5 9.8Z" />
	{:else}
		<circle cx="5" cy="5" r="4" />
	{/if}
</svg>
