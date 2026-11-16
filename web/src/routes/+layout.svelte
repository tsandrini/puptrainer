<script lang="ts">
	// The shell: navigation, the language switch, and the banners that say
	// when the API or its worker is away or takes are waiting to upload.
	// The shared state (content, devices, queue, service worker) starts here.
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { app } from '#lib/app.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { i18n, locales, type Locale } from '#lib/i18n/index.svelte.js';
	import { pwa } from '#lib/pwa.svelte.js';
	import { queue } from '#lib/queue.svelte.js';
	import { cn } from '#lib/utils.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const links = $derived([
		{
			href: '/',
			label: i18n.t.nav.takes,
			active: (p: string) => p === '/' || p.startsWith('/takes')
		},
		{ href: '/record', label: i18n.t.nav.record, active: (p: string) => p.startsWith('/record') },
		{ href: '/import', label: i18n.t.nav.import, active: (p: string) => p.startsWith('/import') },
		{ href: '/devices', label: i18n.t.nav.devices, active: (p: string) => p.startsWith('/devices') }
	]);

	onMount(() => {
		document.documentElement.lang = i18n.locale;
		// NOTE: the theme follows the system
		const dark = matchMedia('(prefers-color-scheme: dark)');
		const apply = () => document.documentElement.classList.toggle('dark', dark.matches);
		apply();
		dark.addEventListener('change', apply);
		app.start();
		void queue.start();
		void pwa.start();
		return () => dark.removeEventListener('change', apply);
	});
</script>

<div class="mx-auto flex min-h-full max-w-5xl flex-col px-4">
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3">
		<a href="/" class="font-semibold tracking-tight">puptrainer</a>
		<nav class="flex flex-1 flex-wrap gap-1" aria-label="Main">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={link.active(page.url.pathname) ? 'page' : undefined}
					class={cn(
						'rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground',
						link.active(page.url.pathname) && 'bg-accent text-foreground'
					)}
				>
					{link.label}
				</a>
			{/each}
		</nav>
		{#if pwa.installPrompt}
			<Button variant="outline" size="sm" onclick={() => pwa.install()}>
				{i18n.t.common.install}
			</Button>
		{/if}
		<select
			class="select h-8"
			aria-label={i18n.t.common.language}
			value={i18n.locale}
			onchange={(event) => i18n.set(event.currentTarget.value as Locale)}
			data-testid="locale"
		>
			{#each Object.keys(locales) as code (code)}
				<option value={code}>{code.toUpperCase()}</option>
			{/each}
		</select>
	</header>

	{#if !app.reachable}
		<p
			class="mt-3 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
			role="status"
			data-testid="api-down"
		>
			{i18n.t.status.apiDown}
		</p>
	{:else if app.workerDown}
		<p
			class="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
			role="status"
			data-testid="worker-down"
		>
			{i18n.t.status.workerDown}
		</p>
	{/if}
	{#if app.error}
		<p
			class="mt-3 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
			role="alert"
		>
			{app.error}
		</p>
	{/if}

	{#if queue.items.length}
		<section class="mt-3 rounded-md border px-3 py-2 text-sm" data-testid="queue">
			<p class="font-medium">{i18n.t.status.queued(queue.items.length)}</p>
			<ul class="mt-1 space-y-1">
				{#each queue.items as item (item.id)}
					<li class="flex flex-wrap items-center gap-2">
						<span class="font-mono text-xs">{item.name}</span>
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

	<main class="flex-1 py-6">
		{@render children()}
	</main>
</div>
