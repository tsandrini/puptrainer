<script lang="ts">
	// The mark of a voice, the same in every table, legend and chart: an
	// attempt is a solid line with a filled dot, the everyday voice a dashed
	// line with a hollow dot, a drill (a sound, not a voice) a dotted line.
	import type { Intent } from '#lib/api/types.js';
	import { cn } from '#lib/utils.js';

	let {
		intent,
		color = 'currentColor',
		class: className
	}: { intent: Intent; color?: string; class?: string } = $props();
</script>

<svg
	viewBox="0 0 22 10"
	class={cn('inline-block h-2.5 w-5.5 shrink-0', className)}
	aria-hidden="true"
	data-voice-mark={intent}
>
	<line
		x1="1"
		x2="21"
		y1="5"
		y2="5"
		stroke={color}
		stroke-width="2"
		stroke-linecap="round"
		stroke-dasharray={intent === 'attempt'
			? undefined
			: intent === 'habitual'
				? '4 3.5'
				: '0.5 3.5'}
	/>
	{#if intent !== 'drill'}
		<circle
			cx="11"
			cy="5"
			r="3"
			fill={intent === 'attempt' ? color : 'var(--card)'}
			stroke={color}
			stroke-width="1.75"
		/>
	{/if}
</svg>
