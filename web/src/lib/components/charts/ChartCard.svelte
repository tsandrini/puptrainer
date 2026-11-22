<script lang="ts" module>
	import type { EChartsOption } from 'echarts';
	import type { CsvCell } from '#lib/csv.js';

	/** What a chart shows, as rows: for the table view and the CSV. */
	export type ChartTable = { headers: string[]; rows: CsvCell[][] };
	/** Where the chart is drawn: its card, or the whole screen (with the height it gets there). */
	export type ChartFrame = { full: boolean; height: number };
</script>

<script lang="ts">
	// A chart with everything around it that every chart gets: a title, the
	// help behind a button, its own controls, the same numbers as a table,
	// CSV and PNG to keep, and a view over the whole screen. The chart is
	// given as a function of where it is drawn, so that the large view can
	// be laid out for its size.
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import ImageIcon from '@lucide/svelte/icons/image-down';
	import LineChartIcon from '@lucide/svelte/icons/chart-line';
	import MaximizeIcon from '@lucide/svelte/icons/maximize-2';
	import TableIcon from '@lucide/svelte/icons/table-2';
	import type { ComponentProps, Snippet } from 'svelte';
	import Help from '#lib/components/app/Help.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { datedName, saveFile, toCsv } from '#lib/csv.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { colours } from '#lib/progress/palette.svelte.js';
	import { cn } from '#lib/utils.js';
	import Chart from './Chart.svelte';

	let {
		title,
		sub,
		help,
		option,
		height = 260,
		table,
		name,
		group,
		onpick,
		onselect,
		controls,
		footer,
		class: className
	}: {
		title: string;
		/** A few words beside the title: the unit, how many takes. */
		sub?: string;
		help?: { text: string | readonly string[]; children?: Snippet };
		option: (frame: ChartFrame) => EChartsOption;
		height?: number;
		table?: () => ChartTable;
		/** What the files it saves are called, and what the browser tests find it by. */
		name: string;
		group?: string;
		onpick?: ComponentProps<typeof Chart>['onpick'];
		onselect?: ComponentProps<typeof Chart>['onselect'];
		/** The chart's own switches, in its header. */
		controls?: Snippet;
		footer?: Snippet;
		class?: string;
	} = $props();

	let mode = $state<'chart' | 'table'>('chart');
	let full = $state(false);
	let room = $state(0);
	let small = $state<Chart | null>(null);
	let large = $state<Chart | null>(null);

	const rows = $derived(mode === 'table' || full ? table?.() : undefined);

	function savePng(): void {
		const url = (full ? large : small)?.image(colours.value.card);
		if (!url) return;
		void fetch(url)
			.then((response) => response.blob())
			.then((blob) => saveFile(datedName(name, 'png'), blob));
	}
	function saveCsv(): void {
		const data = table?.();
		if (data) saveFile(datedName(name, 'csv'), toCsv([data.headers, ...data.rows]));
	}
</script>

{#snippet tools()}
	{#if table}
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={i18n.t.chart.csv}
			title={i18n.t.chart.csv}
			onclick={saveCsv}
		>
			<DownloadIcon />
		</Button>
	{/if}
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label={i18n.t.chart.png}
		title={i18n.t.chart.png}
		onclick={savePng}
	>
		<ImageIcon />
	</Button>
{/snippet}

{#snippet more()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon-sm"
					aria-label={i18n.t.chart.more}
					title={i18n.t.chart.more}
					data-testid="chart-more"
				>
					<EllipsisIcon />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="min-w-56">
			{#if table}
				<DropdownMenu.Item
					onSelect={() => (mode = mode === 'table' ? 'chart' : 'table')}
					data-testid="chart-table-toggle"
				>
					{#if mode === 'table'}<LineChartIcon />{:else}<TableIcon />{/if}
					{mode === 'table' ? i18n.t.chart.asChart : i18n.t.chart.asTable}
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={saveCsv} data-testid="chart-csv">
					<DownloadIcon />
					{i18n.t.chart.csv}
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item onSelect={savePng} disabled={mode === 'table'} data-testid="chart-png">
				<ImageIcon />
				{i18n.t.chart.png}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

{#snippet numbers(data: ChartTable)}
	<table class="w-full text-left text-xs tabular-nums">
		<thead class="sticky top-0 bg-card">
			<tr>
				{#each data.headers as header (header)}
					<th class="border-b px-2 py-1.5 font-bold whitespace-nowrap">{header}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each data.rows as row, index (index)}
				<tr class="border-b border-border/60 last:border-0">
					{#each row as cell, at (at)}
						<td class="px-2 py-1 whitespace-nowrap">{cell ?? '–'}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<section
	class={cn('panel flex min-w-0 flex-col gap-2 p-3', className)}
	data-testid="chart-card"
	data-chart={name}
>
	<header class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
		<h3 class="text-sm font-bold">{title}</h3>
		{#if help}
			<Help {title} text={help.text} wide={Boolean(help.children)}>{@render help.children?.()}</Help
			>
		{/if}
		{#if sub}<span class="text-xs text-muted-foreground">{sub}</span>{/if}
		<div class="ms-auto flex flex-wrap items-center gap-1">
			{@render controls?.()}
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={i18n.t.chart.full}
				title={i18n.t.chart.full}
				onclick={() => (full = true)}
				data-testid="chart-full"
			>
				<MaximizeIcon />
			</Button>
			{@render more()}
		</div>
	</header>
	{#if mode === 'table' && rows}
		<div
			class="overflow-auto rounded-md border"
			style:max-height="{height}px"
			data-testid="chart-table"
		>
			{@render numbers(rows)}
		</div>
	{:else}
		<Chart
			bind:this={small}
			option={option({ full: false, height })}
			{height}
			{group}
			label={title}
			{onpick}
			{onselect}
		/>
	{/if}
	{@render footer?.()}
</section>

<Dialog.Root bind:open={full}>
	<Dialog.Content
		class="flex h-[94vh] w-[96vw] max-w-[96vw] flex-col gap-2 p-4 sm:max-w-[96vw]"
		data-testid="chart-dialog"
	>
		<Dialog.Header class="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 pe-10">
			<Dialog.Title class="text-base font-bold">{title}</Dialog.Title>
			{#if help}
				<Help {title} text={help.text} wide={Boolean(help.children)}
					>{@render help.children?.()}</Help
				>
			{/if}
			{#if sub}<Dialog.Description class="text-xs">{sub}</Dialog.Description>{/if}
			<div class="ms-auto flex flex-wrap items-center gap-1">
				{@render controls?.()}
				{@render tools()}
			</div>
		</Dialog.Header>
		<div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_auto]">
			<div class="min-h-0 min-w-0" bind:clientHeight={room}>
				{#if room > 0}
					<Chart
						bind:this={large}
						option={option({ full: true, height: room })}
						height="fill"
						label={title}
						{onpick}
						{onselect}
					/>
				{/if}
			</div>
			{#if rows}
				<div class="hidden max-h-full w-80 overflow-auto rounded-md border lg:block">
					{@render numbers(rows)}
				</div>
			{/if}
		</div>
		{@render footer?.()}
	</Dialog.Content>
</Dialog.Root>
