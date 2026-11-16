<script lang="ts">
	// System, light or dark: three small buttons, the current one pressed.
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { theme, type ThemeMode } from '#lib/theme.svelte.js';
	import { cn } from '#lib/utils.js';

	const modes = [
		{ mode: 'system', Icon: MonitorIcon },
		{ mode: 'light', Icon: SunIcon },
		{ mode: 'dark', Icon: MoonIcon }
	] as const satisfies { mode: ThemeMode; Icon: unknown }[];
</script>

<div
	class="flex rounded-full border bg-card p-0.5"
	role="group"
	aria-label={i18n.t.theme.label}
	data-testid="theme"
>
	{#each modes as { mode, Icon } (mode)}
		<button
			type="button"
			class={cn(
				'rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground',
				theme.mode === mode && 'bg-primary text-primary-foreground hover:text-primary-foreground'
			)}
			aria-pressed={theme.mode === mode}
			title={i18n.t.theme[mode]}
			data-mode={mode}
			onclick={() => theme.set(mode)}
		>
			<Icon class="size-3.5" />
			<span class="sr-only">{i18n.t.theme[mode]}</span>
		</button>
	{/each}
</div>
