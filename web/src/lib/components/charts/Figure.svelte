<script lang="ts">
	// A chart card: title, a line of explanation, an optional legend, the
	// chart, and the table view every chart carries (the values without
	// hovering).
	import type { Snippet } from 'svelte';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	export type LegendItem = { label: string; color: string };

	let {
		title,
		sub,
		value,
		legend,
		table,
		class: className,
		children
	}: {
		title: string;
		sub?: string;
		/** The headline number, shown beside the title. */
		value?: string;
		legend?: LegendItem[];
		table?: { headers: string[]; rows: string[][] } | null;
		class?: string;
		children?: Snippet;
	} = $props();

	let open = $state(false);
</script>

<figure class={cn('panel flex min-w-0 flex-col gap-2', className)}>
	<figcaption>
		<div class="flex items-baseline justify-between gap-3">
			<span class="text-sm font-bold">{title}</span>
			{#if value}<span class="text-lg font-extrabold tabular-nums">{value}</span>{/if}
		</div>
		{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}
	</figcaption>
	{#if legend && legend.length > 1}
		<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
			{#each legend as item (item.label)}
				<li class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-full" style:background={item.color}></span>{item.label}
				</li>
			{/each}
		</ul>
	{/if}
	{@render children?.()}
	{#if table}
		<button
			type="button"
			class="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{open ? i18n.t.common.hideValues : i18n.t.common.showValues}
		</button>
		{#if open}
			<div class="max-h-56 overflow-auto">
				<table class="w-full text-xs tabular-nums">
					<thead class="text-left text-muted-foreground">
						<tr>
							{#each table.headers as header (header)}<th class="py-1 pr-3 font-medium">{header}</th
								>{/each}
						</tr>
					</thead>
					<tbody>
						{#each table.rows as row, i (i)}
							<tr class="border-t">
								{#each row as cell, j (j)}<td class="py-1 pr-3">{cell}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</figure>
