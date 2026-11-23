<script lang="ts">
	// The shell: the paw and the navigation, the language and theme
	// switches, the banners that say when the API or its worker is away or
	// takes are waiting to upload, and the player's dock along the bottom.
	// The shared state (content, devices, queue, service worker, theme)
	// starts here. The shell is one width on every page; inside it pages of
	// data take the room and pages to read keep a column.
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import AudioLinesIcon from '@lucide/svelte/icons/audio-lines';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UsersIcon from '@lucide/svelte/icons/users';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { app } from '#lib/app.svelte.js';
	import CommandPalette from '#lib/components/app/CommandPalette.svelte';
	import Login from '#lib/components/app/Login.svelte';
	import PlayerDock from '#lib/components/audio/PlayerDock.svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { overlays } from '#lib/overlays.svelte.js';
	import { player } from '#lib/player.svelte.js';
	import { isTake } from '#lib/store.js';
	import Paw from '#lib/components/app/Paw.svelte';
	import ThemeToggle from '#lib/components/app/ThemeToggle.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { i18n, locales, type Locale } from '#lib/i18n/index.svelte.js';
	import { pwa } from '#lib/pwa.svelte.js';
	import { queue } from '#lib/queue.svelte.js';
	import { theme } from '#lib/theme.svelte.js';
	import { cn } from '#lib/utils.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const starts = (prefix: string) => (path: string) => path.startsWith(prefix);
	const links = $derived([
		{
			href: '/',
			label: i18n.t.nav.takes,
			Icon: AudioLinesIcon,
			active: (p: string) => p === '/' || p.startsWith('/takes') || p.startsWith('/compare')
		},
		{
			href: '/practice',
			label: i18n.t.nav.practice,
			Icon: Paw,
			active: starts('/practice')
		},
		{ href: '/record', label: i18n.t.nav.record, Icon: MicIcon, active: starts('/record') },
		{
			href: '/progress',
			label: i18n.t.nav.progress,
			Icon: TrendingUpIcon,
			active: starts('/progress')
		},
		{ href: '/import', label: i18n.t.nav.import, Icon: UploadIcon, active: starts('/import') },
		{ href: '/devices', label: i18n.t.nav.devices, Icon: SlidersIcon, active: starts('/devices') },
		{ href: '/people', label: i18n.t.nav.people, Icon: UsersIcon, active: starts('/people') }
	]);

	/**
	 * The pages that are for reading and filling in keep a column in the middle;
	 * the ones of tables and graphs take the room there is. The shell itself (the
	 * paw, the navigation, the banners) is the same width everywhere, so nothing
	 * of it moves from page to page.
	 */
	const column = $derived(
		['/practice', '/record', '/import', '/devices', '/people'].some((path) =>
			page.url.pathname.startsWith(path)
		)
	);

	onMount(() => {
		document.documentElement.lang = i18n.locale;
		const stopTheme = theme.start();
		app.start();
		void queue.start();
		void pwa.start();
		return stopTheme;
	});
</script>

<div class="paw-trail"></div>

<Tooltip.Provider delayDuration={300}>
	<div class="mx-auto flex min-h-full max-w-[110rem] flex-col px-4">
		<header class="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
			<a href="/" class="flex items-center gap-2 text-lg font-black tracking-tight">
				<span
					class="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"
				>
					<Paw class="size-5" />
				</span>
				puptrainer
			</a>
			<nav
				class="order-last flex w-full gap-1 overflow-x-auto rounded-full border bg-card p-1 shadow-xs sm:order-none sm:ml-3 sm:w-auto"
				aria-label="Main"
			>
				{#each links as link (link.href)}
					<a
						href={link.href}
						aria-current={link.active(page.url.pathname) ? 'page' : undefined}
						class={cn(
							'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
							link.active(page.url.pathname) &&
								'bg-primary text-primary-foreground hover:text-primary-foreground'
						)}
					>
						<link.Icon class="size-4" />
						{link.label}
					</a>
				{/each}
			</nav>
			<div class="ml-auto flex items-center gap-2">
				{#if pwa.installPrompt}
					<Button variant="outline" size="sm" onclick={() => pwa.install()}>
						{i18n.t.common.install}
					</Button>
				{/if}
				{#if app.loginRequired && !app.needLogin}
					<Button variant="ghost" size="sm" onclick={() => app.signOut()} data-testid="sign-out">
						{i18n.t.login.signOut}
					</Button>
				{/if}
				{#if !app.needLogin}
					<Button
						variant="outline"
						size="sm"
						class="hidden gap-2 text-muted-foreground lg:inline-flex"
						onclick={() => (overlays.palette = true)}
						data-testid="palette-open"
					>
						<SearchIcon />
						{i18n.t.palette.open}
						<kbd class="rounded border bg-muted px-1 font-mono text-[0.65rem]">Ctrl K</kbd>
					</Button>
				{/if}
				<ThemeToggle />
				<select
					class="select h-8 rounded-full"
					aria-label={i18n.t.common.language}
					value={i18n.locale}
					onchange={(event) => i18n.set(event.currentTarget.value as Locale)}
					data-testid="locale"
				>
					{#each Object.keys(locales) as code (code)}
						<option value={code}>{code.toUpperCase()}</option>
					{/each}
				</select>
			</div>
		</header>

		{#if !app.reachable}
			<p
				class="mb-3 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
				role="status"
				data-testid="api-down"
			>
				{i18n.t.status.apiDown}
			</p>
		{:else if app.workerDown}
			<p
				class="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
				role="status"
				data-testid="worker-down"
			>
				{i18n.t.status.workerDown}
			</p>
		{/if}
		{#if app.error}
			<p
				class="mb-3 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
				role="alert"
			>
				{app.error}
			</p>
		{/if}

		{#if queue.items.length}
			<section class="panel mb-3 text-sm" data-testid="queue">
				<p class="font-bold">
					{queue.takes.length
						? i18n.t.status.queued(queue.takes.length)
						: i18n.t.status.practiceQueued}
				</p>
				<ul class="mt-1 space-y-1">
					{#each queue.items as item (item.id)}
						<li class="flex flex-wrap items-center gap-2">
							<span class="font-mono text-xs"
								>{isTake(item) ? item.name : i18n.t.queue.practice}</span
							>
							{#if item.rejected}
								<span class="text-critical">{i18n.t.queue.rejected}: {item.error}</span>
							{/if}
							<Button
								variant="ghost"
								size="sm"
								class="ml-auto"
								onclick={() => queue.discard(item.id)}
							>
								{i18n.t.common.discard}
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<main
			class={cn(
				'w-full flex-1 pt-2',
				column && 'mx-auto max-w-5xl',
				player.take ? 'pb-32' : 'pb-10'
			)}
		>
			{#if app.needLogin}
				<Login />
			{:else}
				{@render children()}
			{/if}
		</main>
	</div>
	{#if !app.needLogin}
		<PlayerDock />
		<CommandPalette />
	{/if}
</Tooltip.Provider>
