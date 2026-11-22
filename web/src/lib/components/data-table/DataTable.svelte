<script lang="ts" module>
	/** The page sizes on offer. */
	export const PAGE_SIZES = [25, 50, 100, 250] as const;

	type Order = { id: string; desc: boolean }[];
	/** The sorting as a text for a link: `-recorded,pitch`. */
	export const encodeSort = (order: Order): string =>
		order.map((s) => (s.desc ? '-' : '') + s.id).join(',');
	export const decodeSort = (text: string): Order =>
		text
			.split(',')
			.filter(Boolean)
			.map((part) =>
				part.startsWith('-') ? { id: part.slice(1), desc: true } : { id: part, desc: false }
			);
</script>

<script lang="ts" generics="T">
	// The app's table: rows already in memory, searched, sorted and paged
	// here. A toolbar (search, the page's filters, the column picker, the
	// page's actions), headers that sort (shift-click for a second key),
	// rows that can be ticked for what the page offers to do with several,
	// and a footer that says where in the list one is. What it shows is
	// state of the page (bound), so the page can keep it in its address.
	import {
		getCoreRowModel,
		getPaginationRowModel,
		getSortedRowModel,
		type ColumnDef,
		type RowSelectionState,
		type SortingState,
		type Updater,
		type VisibilityState
	} from '@tanstack/table-core';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronsLeftIcon from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@lucide/svelte/icons/chevrons-right';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import ColumnsIcon from '@lucide/svelte/icons/columns-3';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { untrack, type Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import {
		FlexRender,
		createSvelteTable,
		renderSnippet
	} from '#lib/components/ui/data-table/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { folded, hasWords, searchWords } from '#lib/highlight.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	const DEBOUNCE_MS = 200;

	let {
		columns,
		rows,
		rowId,
		text,
		search = $bindable(''),
		sort = $bindable(''),
		page = $bindable(1),
		size = $bindable(PAGE_SIZES[0]),
		hidden = $bindable([]),
		selected = $bindable([]),
		shown = $bindable([]),
		loading = false,
		selectable = false,
		label,
		emptyText,
		rowClass,
		filters,
		actions,
		bulk
	}: {
		columns: ColumnDef<T>[];
		/** The rows after the page's own filters. */
		rows: T[];
		rowId: (row: T) => string;
		/** What search looks through for a row; no search box without it. */
		text?: (row: T) => string;
		search?: string;
		/** The sorting as `encodeSort` writes it. */
		sort?: string;
		/** The page, from one. */
		page?: number;
		size?: number;
		/** The ids of the columns not shown. */
		hidden?: string[];
		/** The ids of the ticked rows. */
		selected?: string[];
		/** Out only: the rows as searched and sorted, over all pages. */
		shown?: T[];
		/** The first load is still on its way. */
		loading?: boolean;
		selectable?: boolean;
		/** What the table lists, for assistive technology. */
		label: string;
		/** What an empty table says when nothing was searched for. */
		emptyText?: string;
		rowClass?: (row: T) => string | false | null | undefined;
		/** The page's filters, after the search box. */
		filters?: Snippet;
		/** The page's own buttons, at the right end of the toolbar. */
		actions?: Snippet;
		/** What can be done with the ticked rows. */
		bulk?: Snippet<[T[]]>;
	} = $props();

	let typed = $state(untrack(() => search));
	let field = $state<HTMLInputElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const words = $derived(searchWords(search));
	const texts = $derived(text ? rows.map((row) => folded(text(row))) : []);
	const found = $derived(
		text && words.length ? rows.filter((_, index) => hasWords(texts[index], words)) : rows
	);
	const sorting = $derived<SortingState>(decodeSort(sort));
	const visibility = $derived<VisibilityState>(Object.fromEntries(hidden.map((id) => [id, false])));
	const selection = $derived<RowSelectionState>(
		Object.fromEntries(selected.map((id) => [id, true]))
	);
	const pages = $derived(Math.max(1, Math.ceil(found.length / size)));
	const ticked = $derived(rows.filter((row) => selection[rowId(row)]));

	const apply = <S,>(updater: Updater<S>, current: S): S =>
		typeof updater === 'function' ? (updater as (old: S) => S)(current) : updater;

	/** The column of tick boxes. */
	const tick: ColumnDef<T> = {
		id: '_tick',
		enableSorting: false,
		enableHiding: false,
		header: () => renderSnippet(tickAll, { label: i18n.t.table.tickAll }),
		cell: ({ row }) => renderSnippet(tickOne, { id: row.id }),
		meta: { headClass: 'w-9', cellClass: 'w-9' }
	};

	const table = createSvelteTable<T>({
		get data() {
			return found;
		},
		get columns() {
			return selectable ? [tick, ...columns] : columns;
		},
		state: {
			get sorting() {
				return sorting;
			},
			get pagination() {
				return { pageIndex: page - 1, pageSize: size };
			},
			get columnVisibility() {
				return visibility;
			},
			get rowSelection() {
				return selection;
			}
		},
		getRowId: (row) => rowId(row),
		enableSortingRemoval: true,
		// NOTE: the page is the page's state: nothing here rewinds it behind its back
		autoResetPageIndex: false,
		onSortingChange: (updater) => {
			sort = encodeSort(apply(updater, sorting));
			page = 1;
		},
		onPaginationChange: (updater) => {
			const next = apply(updater, { pageIndex: page - 1, pageSize: size });
			[page, size] = [next.pageIndex + 1, next.pageSize];
		},
		onColumnVisibilityChange: (updater) => {
			const next = apply(updater, visibility);
			hidden = Object.keys(next).filter((id) => next[id] === false);
		},
		onRowSelectionChange: (updater) => {
			const next = apply(updater, selection);
			selected = Object.keys(next).filter((id) => next[id]);
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel()
	});

	function commit(): void {
		clearTimeout(timer);
		if (search === typed) return;
		search = typed;
		page = 1;
	}

	// the rows as searched and sorted, for whoever walks through them
	$effect(() => {
		shown = table.getSortedRowModel().rows.map((row) => row.original);
	});
	// a search changed from outside (a reset, a link)
	$effect(() => {
		const outside = search;
		untrack(() => {
			if (outside !== typed) typed = outside;
		});
	});
	// never a page past the last one, never a tick on a row that is gone
	$effect(() => {
		if (page > pages) page = pages;
	});
	$effect(() => {
		const ids = rows.map(rowId);
		untrack(() => {
			if (selected.some((id) => !ids.includes(id)))
				selected = selected.filter((id) => ids.includes(id));
		});
	});
</script>

<svelte:window
	onkeydown={(event) => {
		// NOTE: "/" goes to the search box, as in most lists that have one
		if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || !field) return;
		if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
			return;
		event.preventDefault();
		field.focus();
	}}
/>

{#snippet tickAll({ label }: { label: string })}
	<Checkbox
		checked={table.getIsAllRowsSelected()}
		indeterminate={table.getIsSomeRowsSelected()}
		onCheckedChange={(on) => table.toggleAllRowsSelected(on)}
		aria-label={label}
		data-testid="tick-all"
	/>
{/snippet}

{#snippet tickOne({ id }: { id: string })}
	<Checkbox
		checked={selection[id] ?? false}
		onCheckedChange={(on) => table.getRow(id).toggleSelected(on)}
		aria-label={i18n.t.table.tick}
		data-testid="tick"
	/>
{/snippet}

<div class="space-y-3" data-testid="data-table" data-rows={found.length} data-page={page}>
	<div class="flex flex-wrap items-center gap-2">
		{#if text}
			<div class="relative min-w-48 flex-1 sm:max-w-xs">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<input
					bind:this={field}
					type="search"
					class="h-8 w-full rounded-lg border border-input bg-card pr-2 pl-8 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					placeholder={i18n.t.table.searchHint}
					aria-label={i18n.t.table.search}
					value={typed}
					oninput={(event) => {
						typed = event.currentTarget.value;
						clearTimeout(timer);
						timer = setTimeout(commit, DEBOUNCE_MS);
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter') commit();
						else if (event.key === 'Escape' && typed) {
							typed = '';
							commit();
						}
					}}
					data-testid="table-search"
				/>
			</div>
		{/if}
		{@render filters?.()}
		<div class="ms-auto flex items-center gap-2">
			{@render actions?.()}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm" class="h-8" data-testid="table-columns">
							<ColumnsIcon />
							<span class="hidden sm:inline">{i18n.t.table.columns}</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="max-h-96 min-w-52 overflow-y-auto">
					{#each table
						.getAllLeafColumns()
						.filter((column) => column.getCanHide()) as column (column.id)}
						<DropdownMenu.CheckboxItem
							checked={column.getIsVisible()}
							onCheckedChange={(on) => column.toggleVisibility(on)}
							closeOnSelect={false}
							data-column={column.id}
						>
							{column.columnDef.meta?.label ?? column.id}
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>

	{#if bulk && ticked.length}
		<div
			class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm"
			data-testid="table-bulk"
		>
			<span class="font-bold tabular-nums">{i18n.t.table.ticked(ticked.length)}</span>
			{@render bulk(ticked)}
			<Button
				variant="ghost"
				size="sm"
				class="ms-auto"
				onclick={() => (selected = [])}
				data-testid="table-untick"
			>
				<XIcon />
				{i18n.t.table.untick}
			</Button>
		</div>
	{/if}

	<div class="overflow-x-auto rounded-xl border bg-card shadow-xs">
		<Table.Root aria-label={label}>
			<Table.Header>
				{#each table.getHeaderGroups() as group (group.id)}
					<Table.Row class="hover:bg-transparent">
						{#each group.headers as header (header.id)}
							{@const column = header.column}
							{@const order = column.getIsSorted()}
							<Table.Head
								class={cn('h-9 whitespace-nowrap', column.columnDef.meta?.headClass)}
								aria-sort={order === 'asc'
									? 'ascending'
									: order === 'desc'
										? 'descending'
										: undefined}
								title={column.columnDef.meta?.title}
							>
								{#if header.isPlaceholder}
									<!-- nothing -->
								{:else if column.getCanSort()}
									<button
										type="button"
										class={cn(
											'-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-inherit outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
											order && 'text-foreground'
										)}
										onclick={(event) => column.toggleSorting(undefined, event.shiftKey)}
										data-sort={column.id}
										data-order={order || 'none'}
									>
										<FlexRender content={column.columnDef.header} context={header.getContext()} />
										{#if order === 'asc'}<ArrowUpIcon class="size-3.5" />
										{:else if order === 'desc'}<ArrowDownIcon class="size-3.5" />
										{:else}<ChevronsUpDownIcon class="size-3.5 opacity-40" />{/if}
										{#if order && sorting.length > 1}
											<span class="text-[0.65rem] tabular-nums">{column.getSortIndex() + 1}</span>
										{/if}
									</button>
								{:else}
									<FlexRender content={column.columnDef.header} context={header.getContext()} />
								{/if}
							</Table.Head>
						{/each}
					</Table.Row>
				{/each}
			</Table.Header>
			<Table.Body>
				{#if loading}
					{#each [0, 1, 2, 3, 4] as line (line)}
						<Table.Row class="hover:bg-transparent">
							{#each table.getVisibleLeafColumns() as column (column.id)}
								<Table.Cell><Skeleton class="h-4 w-full max-w-32" /></Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				{:else}
					{#each table.getRowModel().rows as row (row.id)}
						<Table.Row
							class={cn(rowClass?.(row.original))}
							data-state={selection[row.id] ? 'selected' : undefined}
							data-row={row.id}
						>
							{#each row.getVisibleCells() as cell (cell.id)}
								<Table.Cell
									class={cn('py-1 whitespace-nowrap', cell.column.columnDef.meta?.cellClass)}
								>
									<FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
								</Table.Cell>
							{/each}
						</Table.Row>
					{:else}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell
								colspan={table.getVisibleLeafColumns().length}
								class="h-24 text-center text-muted-foreground"
								data-testid="table-empty"
							>
								{words.length ? i18n.t.table.nothingFound : (emptyText ?? i18n.t.table.nothing)}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	{#if !loading && found.length}
		<div
			class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
			data-testid="table-footer"
		>
			<span class="tabular-nums" data-testid="table-range">
				{i18n.t.table.showing(
					(page - 1) * size + 1,
					Math.min(page * size, found.length),
					found.length
				)}{#if found.length !== rows.length}
					· {i18n.t.table.of(rows.length)}{/if}
			</span>
			<div class="flex items-center gap-2">
				<label class="hidden items-center gap-2 sm:flex">
					{i18n.t.table.perPage}
					<select
						class="select h-7 px-1 text-sm"
						value={size}
						onchange={(event) => {
							size = Number(event.currentTarget.value);
							page = 1;
						}}
						data-testid="table-size"
					>
						{#each PAGE_SIZES as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
				<Button
					variant="outline"
					size="icon-sm"
					class="hidden sm:inline-flex"
					disabled={page <= 1}
					aria-label={i18n.t.table.first}
					onclick={() => (page = 1)}
				>
					<ChevronsLeftIcon />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					disabled={page <= 1}
					aria-label={i18n.t.table.previous}
					onclick={() => (page -= 1)}
					data-testid="table-previous"
				>
					<ChevronLeftIcon />
				</Button>
				<span class="tabular-nums" data-testid="table-page">{i18n.t.table.page(page, pages)}</span>
				<Button
					variant="outline"
					size="icon-sm"
					disabled={page >= pages}
					aria-label={i18n.t.table.next}
					onclick={() => (page += 1)}
					data-testid="table-next"
				>
					<ChevronRightIcon />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					class="hidden sm:inline-flex"
					disabled={page >= pages}
					aria-label={i18n.t.table.last}
					onclick={() => (page = pages)}
				>
					<ChevronsRightIcon />
				</Button>
			</div>
		</div>
	{/if}
</div>
