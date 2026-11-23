<script lang="ts" module>
	export type Facet = { value: string; label: string; count?: number };
</script>

<script lang="ts">
	// One filter of a table's toolbar: several of a few choices, each with
	// how many rows it has. The button says what is chosen; the list opens on
	// a click, searches itself when it is long, and clears itself.
	import type { Snippet } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { folded } from '#lib/highlight.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	/** A list longer than this gets a search box. */
	const LONG = 8;

	let {
		label,
		options,
		value = $bindable([]),
		onchange,
		mark,
		testid
	}: {
		label: string;
		options: Facet[];
		/** The chosen values; none is "any". */
		value?: string[];
		onchange?: (value: string[]) => void;
		/** Something drawn before a choice's label: the mark it has on a chart. */
		mark?: Snippet<[Facet]>;
		testid?: string;
	} = $props();

	let open = $state(false);
	let query = $state('');

	const chosen = $derived(options.filter((option) => value.includes(option.value)));
	const listed = $derived(
		query ? options.filter((option) => folded(option.label).includes(folded(query))) : options
	);

	function set(next: string[]): void {
		value = next;
		onchange?.(next);
	}
	const toggle = (option: string) =>
		set(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
</script>

<Popover.Root bind:open onOpenChange={(now) => now || (query = '')}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class={cn('h-8 gap-1.5 border-dashed', chosen.length && 'border-solid border-primary/50')}
				data-testid={testid}
				data-chosen={value.join(',')}
			>
				{label}
				{#if chosen.length}
					<span class="h-4 w-px bg-border"></span>
					<span class="max-w-40 truncate font-bold text-primary">
						{chosen.length > 2
							? i18n.t.table.chosen(chosen.length)
							: chosen.map((c) => c.label).join(', ')}
					</span>
				{/if}
				<ChevronDownIcon class="size-3.5 text-muted-foreground" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-64 gap-1 p-1.5">
		{#if options.length > LONG}
			<input
				type="search"
				class="mb-1 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				placeholder={i18n.t.table.search}
				aria-label={i18n.t.table.search}
				bind:value={query}
			/>
		{/if}
		<ul
			class="max-h-72 overflow-y-auto"
			role="listbox"
			aria-multiselectable="true"
			aria-label={label}
		>
			{#each listed as option (option.value)}
				{@const on = value.includes(option.value)}
				<li role="option" aria-selected={on}>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
						onclick={() => toggle(option.value)}
						data-option={option.value}
					>
						<span
							class={cn(
								'grid size-4 shrink-0 place-items-center rounded-[4px] border border-input',
								on && 'border-primary bg-primary text-primary-foreground'
							)}
						>
							{#if on}<CheckIcon class="size-3" />{/if}
						</span>
						{@render mark?.(option)}
						<span class="min-w-0 flex-1 truncate">{option.label}</span>
						{#if option.count !== undefined}
							<span class="text-xs text-muted-foreground tabular-nums">{option.count}</span>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-2 py-3 text-center text-sm text-muted-foreground">{i18n.t.table.nothing}</li>
			{/each}
		</ul>
		{#if value.length}
			<Button
				variant="ghost"
				size="sm"
				class="mt-1 w-full"
				onclick={() => set([])}
				data-testid="facet-clear"
			>
				{i18n.t.table.clear}
			</Button>
		{/if}
	</Popover.Content>
</Popover.Root>
