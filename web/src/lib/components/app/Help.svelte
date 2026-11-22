<script lang="ts">
	// The app's place for explanation: a page shows data and controls, and
	// what a thing means, how to read it and how far to trust it sits behind
	// this button. A click opens it, another click, a click elsewhere or Esc
	// closes it; nothing opens on hover (there is none on a phone).
	import CircleHelpIcon from '@lucide/svelte/icons/circle-question-mark';
	import type { Snippet } from 'svelte';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	let {
		title,
		text = [],
		wide = false,
		align = 'start',
		class: className,
		children
	}: {
		/** What is explained; also the button's name for assistive technology. */
		title: string;
		/** The explanation: a paragraph, or several. */
		text?: string | readonly string[];
		/** Room for a picture or a table. */
		wide?: boolean;
		align?: 'start' | 'center' | 'end';
		class?: string;
		/** Anything beyond paragraphs: a legend, a key table, a small figure. */
		children?: Snippet;
	} = $props();

	const paragraphs = $derived((typeof text === 'string' ? [text] : text).filter(Boolean));
</script>

<Popover.Root>
	<Popover.Trigger
		class={cn(
			'inline-grid size-6 shrink-0 place-items-center rounded-full align-middle text-muted-foreground/70 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted data-[state=open]:text-foreground',
			className
		)}
		aria-label={i18n.t.help.about(title)}
		data-testid="help"
	>
		<CircleHelpIcon class="size-4" />
	</Popover.Trigger>
	<Popover.Content
		{align}
		class={cn(
			'max-h-[min(70vh,34rem)] gap-2 overflow-y-auto p-3.5 font-normal',
			wide ? 'w-[min(92vw,34rem)]' : 'w-[min(92vw,23rem)]'
		)}
		data-testid="help-content"
	>
		<h3 class="text-sm font-bold">{title}</h3>
		{#each paragraphs as paragraph, index (index)}
			<p class="text-sm leading-relaxed text-muted-foreground">{paragraph}</p>
		{/each}
		{@render children?.()}
	</Popover.Content>
</Popover.Root>
