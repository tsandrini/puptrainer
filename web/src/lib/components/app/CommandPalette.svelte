<script lang="ts">
	// One box to get anywhere: Ctrl+K (or ⌘K) opens it, typing narrows the
	// list (words in any order, accents and case folded), the arrows and
	// Enter choose. In it: the pages and Progress's tabs, the sessions and
	// exercises to start, the takes (Enter opens one, Alt+Enter plays it in
	// the dock), and the settings of the shell. "?" opens the list of keys.
	import SearchIcon from '@lucide/svelte/icons/search';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchAllTakes } from '#lib/api/index.js';
	import type { TakeOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { fmtDateTime } from '#lib/format.js';
	import { folded, hasWords, searchWords } from '#lib/highlight.js';
	import { i18n, locales, type Locale } from '#lib/i18n/index.svelte.js';
	import { overlays } from '#lib/overlays.svelte.js';
	import { player } from '#lib/player.svelte.js';
	import { PROGRESS_TABS } from '#lib/progress/tabs.js';
	import { theme, type ThemeMode } from '#lib/theme.svelte.js';
	import { cn } from '#lib/utils.js';
	import Highlight from './Highlight.svelte';

	type Group = 'pages' | 'start' | 'takes' | 'settings';
	type Entry = {
		key: string;
		group: Group;
		label: string;
		/** A few words after the label: what kind of thing it is. */
		hint?: string;
		/** What it does; `other` is Alt+Enter, where an entry has a second thing to do. */
		run: (other: boolean) => void;
	};
	const GROUPS: Group[] = ['pages', 'start', 'takes', 'settings'];
	/** How many takes a search lists: the newest that match. */
	const TAKES = 12;

	let query = $state('');
	let at = $state(0);
	let takes = $state.raw<TakeOut[]>([]);
	let asked = false;
	/** The takes could not be read: the box says so instead of "nothing matches". */
	let takesLost = $state(false);
	let list = $state<HTMLUListElement | null>(null);

	const to = (href: string) => () => void goto(href);
	const whatOf = (take: TakeOut) =>
		(app.exerciseOf(take.exercise_ref)
			? i18n.pick(app.exerciseOf(take.exercise_ref)?.titles)
			: i18n.t.item[take.item]) + (take.language ? `, ${i18n.language(take.language)}` : '');

	const entries = $derived<Entry[]>([
		{ key: 'page:takes', group: 'pages', label: i18n.t.nav.takes, run: to('/') },
		{ key: 'page:practice', group: 'pages', label: i18n.t.nav.practice, run: to('/practice') },
		{ key: 'page:record', group: 'pages', label: i18n.t.nav.record, run: to('/record') },
		...PROGRESS_TABS.map((tab) => ({
			key: `page:progress:${tab}`,
			group: 'pages' as const,
			label: `${i18n.t.nav.progress}: ${i18n.t.progress.tabs[tab]}`,
			run: to(`/progress?tab=${tab}`)
		})),
		{ key: 'page:import', group: 'pages', label: i18n.t.nav.import, run: to('/import') },
		{ key: 'page:devices', group: 'pages', label: i18n.t.nav.devices, run: to('/devices') },
		{ key: 'page:people', group: 'pages', label: i18n.t.nav.people, run: to('/people') },
		...(app.content?.routines ?? []).map((routine) => ({
			key: `routine:${routine.id}`,
			group: 'start' as const,
			label: i18n.pick(routine.titles),
			hint: `${i18n.t.palette.session} · ${i18n.t.practice.minutes(routine.minutes)}`,
			run: to(`/practice/run?routine=${routine.id}`)
		})),
		...(app.content?.exercises ?? []).map((exercise) => ({
			key: `exercise:${exercise.id}`,
			group: 'start' as const,
			label: i18n.pick(exercise.titles),
			hint: i18n.t.palette.exercise,
			run: to(`/practice/run?exercise=${exercise.id}`)
		})),
		...takes.map((take) => ({
			key: `take:${take.id}`,
			group: 'takes' as const,
			label: `${fmtDateTime(take.recorded_at, i18n.locale)} · ${whatOf(take)}`,
			hint: [
				take.person_id === app.me?.id ? null : app.person(take.person_id)?.name,
				i18n.t.intent[take.intent],
				app.passage(take.content_ref)?.title,
				take.note
			]
				.filter(Boolean)
				.join(' · '),
			run: (other: boolean) => (other ? player.play(take) : void goto(`/takes/${take.id}`))
		})),
		...(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => ({
			key: `theme:${mode}`,
			group: 'settings' as const,
			label: `${i18n.t.theme.label}: ${i18n.t.theme[mode]}`,
			run: () => theme.set(mode)
		})),
		...(Object.keys(locales) as Locale[]).map((code) => ({
			key: `locale:${code}`,
			group: 'settings' as const,
			label: `${i18n.t.common.language}: ${i18n.language(code)}`,
			run: () => i18n.set(code)
		})),
		{
			key: 'keys',
			group: 'settings',
			label: i18n.t.palette.keys,
			hint: '?',
			run: () => (overlays.keys = true)
		}
	]);
	const words = $derived(searchWords(query));
	/** What the box lists: everything but the takes before a word is typed, then what matches. */
	const found = $derived.by(() => {
		if (!words.length) return entries.filter((entry) => entry.group !== 'takes');
		const hits = entries.filter((entry) =>
			hasWords(folded(`${entry.label} ${entry.hint ?? ''}`), words)
		);
		const recordings = hits.filter((entry) => entry.group === 'takes').slice(0, TAKES);
		return GROUPS.flatMap((group) =>
			group === 'takes' ? recordings : hits.filter((entry) => entry.group === group)
		);
	});

	function run(entry: Entry | undefined, other = false): void {
		if (!entry) return;
		overlays.palette = false;
		entry.run(other);
	}

	function move(by: number): void {
		if (!found.length) return;
		at = (at + by + found.length) % found.length;
		void tick().then(() =>
			list?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
		);
	}

	// the first of a new list is the one Enter takes
	$effect(() => {
		void query;
		at = 0;
	});
	// a fresh box every time it opens; the takes are asked for once it is first opened
	$effect(() => {
		if (!overlays.palette) return;
		query = '';
		if (asked) return;
		asked = true;
		void fetchAllTakes()
			.then((all) => {
				takes = all;
				takesLost = false;
			})
			.catch(() => {
				// NOTE: asked again the next time the box opens
				asked = false;
				takesLost = true;
			});
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			overlays.palette = !overlays.palette;
			return;
		}
		if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
		if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
			return;
		event.preventDefault();
		overlays.keys = true;
	}}
/>

<Dialog.Root bind:open={overlays.palette}>
	<Dialog.Content
		class="top-[14%] flex max-h-[70vh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
		showCloseButton={false}
		data-testid="palette"
	>
		<Dialog.Title class="sr-only">{i18n.t.palette.title}</Dialog.Title>
		<Dialog.Description class="sr-only">{i18n.t.palette.hint}</Dialog.Description>
		<div class="flex items-center gap-2 border-b px-3">
			<SearchIcon class="size-4 shrink-0 text-muted-foreground" />
			<input
				class="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				placeholder={i18n.t.palette.hint}
				aria-label={i18n.t.palette.title}
				autocomplete="off"
				spellcheck="false"
				bind:value={query}
				onkeydown={(event) => {
					if (event.key === 'ArrowDown') move(1);
					else if (event.key === 'ArrowUp') move(-1);
					else if (event.key === 'Enter') run(found[at], event.altKey);
					else return;
					event.preventDefault();
				}}
				data-testid="palette-input"
			/>
		</div>
		<ul
			bind:this={list}
			class="min-h-0 flex-1 overflow-y-auto p-1.5"
			role="listbox"
			aria-label={i18n.t.palette.title}
		>
			{#each found as entry, index (entry.key)}
				{#if index === 0 || found[index - 1].group !== entry.group}
					<li class="px-2 pt-2 pb-1 text-xs font-bold text-muted-foreground" role="presentation">
						{i18n.t.palette.groups[entry.group]}
					</li>
				{/if}
				<li role="option" aria-selected={index === at}>
					<button
						type="button"
						class={cn(
							'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm',
							index === at && 'bg-muted'
						)}
						onpointermove={() => (at = index)}
						onclick={(event) => run(entry, event.altKey)}
						data-active={index === at}
						data-entry={entry.key}
					>
						<span class="min-w-0 truncate"><Highlight text={entry.label} {words} /></span>
						{#if entry.hint}
							<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
								<Highlight text={entry.hint} {words} />
							</span>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-2 py-6 text-center text-sm text-muted-foreground" data-testid="palette-empty">
					{i18n.t.palette.nothing}
				</li>
			{/each}
		</ul>
		{#if takesLost}
			<p class="border-t px-3 py-1.5 text-xs text-muted-foreground" data-testid="palette-lost">
				{i18n.t.palette.lost}
			</p>
		{/if}
		<p class="border-t px-3 py-1.5 text-xs text-muted-foreground">{i18n.t.palette.foot}</p>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={overlays.keys}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="keys">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold">{i18n.t.palette.keys}</Dialog.Title>
			<Dialog.Description class="sr-only">{i18n.t.palette.keys}</Dialog.Description>
		</Dialog.Header>
		{#each i18n.t.palette.sections as section (section.title)}
			<section>
				<h3 class="mb-1 text-xs font-bold text-muted-foreground">{section.title}</h3>
				<dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
					{#each section.keys as [key, does] (key)}
						<dt class="whitespace-nowrap">
							<kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
						</dt>
						<dd>{does}</dd>
					{/each}
				</dl>
			</section>
		{/each}
	</Dialog.Content>
</Dialog.Root>
