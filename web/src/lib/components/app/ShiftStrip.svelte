<script lang="ts">
	// A distance from the everyday voice on a strip. Zero is the everyday
	// voice, the grey band around it the scatter of the everyday takes
	// themselves, the tinted zones conventions to read the distance by. One
	// marker for the value, a fainter one for a second value beside it.
	import type { Zone } from '#lib/api/types.js';
	import { fmtSigned } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	let {
		value,
		ghost = null,
		wobble = null,
		zones = [],
		range,
		unit = '%',
		label
	}: {
		value: number | null;
		/** A second value shown faintly, e.g. the last seconds beside the whole take. */
		ghost?: number | null;
		/** The standard deviation of the everyday takes; the band spans two of them either side. */
		wobble?: number | null;
		zones?: Zone[];
		range: [number, number];
		unit?: string;
		label: string;
	} = $props();

	const at = (v: number) =>
		Math.min(100, Math.max(0, ((v - range[0]) / (range[1] - range[0])) * 100));
	const zoneOf = (v: number | null) =>
		v === null
			? null
			: (zones.find((z) => (z.low === null || v >= z.low) && (z.high === null || v <= z.high))
					?.key ?? null);
	const zone = $derived(zoneOf(value));
	const edges = $derived(
		[...new Set(zones.flatMap((z) => [z.low, z.high]))].filter((v) => v !== null)
	);
	const number = (v: number) => `${fmtSigned(v, 0, i18n.locale)} ${unit}`;
	const TINT: Record<string, string> = {
		typical: 'border-x border-good/60 bg-good/15',
		beyond: 'bg-warning/15'
	};
	const SWATCH: Record<string, string> = { typical: 'bg-good/40', beyond: 'bg-warning/40' };
</script>

<div data-testid="shift-strip" data-zone={zone ?? 'none'}>
	<div
		class="relative h-7 overflow-hidden rounded-full bg-muted"
		role="meter"
		aria-label={label}
		aria-valuemin={range[0]}
		aria-valuemax={range[1]}
		aria-valuenow={value ?? undefined}
	>
		{#each zones as z (z.key)}
			<div
				class={cn('absolute inset-y-0', TINT[z.key] ?? 'bg-chart-band')}
				style="left: {at(z.low ?? range[0])}%; width: {at(z.high ?? range[1]) -
					at(z.low ?? range[0])}%"
			></div>
		{/each}
		{#if wobble !== null}
			<div
				class="absolute inset-y-0 bg-foreground/15"
				style="left: {at(-2 * wobble)}%; width: {at(2 * wobble) - at(-2 * wobble)}%"
				data-testid="wobble"
			></div>
		{/if}
		<div class="absolute inset-y-0 w-px bg-foreground/50" style="left: {at(0)}%"></div>
		{#if ghost !== null}
			<div
				class="absolute top-1.5 bottom-1.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground/35 transition-[left] duration-200"
				style="left: {at(ghost)}%"
				data-testid="ghost"
			></div>
		{/if}
		{#if value !== null}
			<div
				class={cn(
					'absolute top-0.5 bottom-0.5 w-2 -translate-x-1/2 rounded-full transition-[left] duration-200',
					zone === 'typical' ? 'bg-good' : zone === 'beyond' ? 'bg-warning' : 'bg-foreground/70'
				)}
				style="left: {at(value)}%"
				data-testid="marker"
			></div>
		{/if}
	</div>
	<div class="relative mt-0.5 h-4 text-xs text-muted-foreground tabular-nums">
		<span class="absolute -translate-x-1/2" style="left: {at(0)}%">{i18n.t.reading.zero}</span>
		{#each edges as edge (edge)}
			<span class="absolute -translate-x-1/2" style="left: {at(edge)}%">{number(edge)}</span>
		{/each}
	</div>
	<ul class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
		{#if wobble !== null}
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-full bg-foreground/25"></span>{i18n.t.reading.yours}
			</li>
		{/if}
		{#each zones as z (z.key)}
			<li class="flex items-center gap-1.5">
				<span class={cn('size-2.5 rounded-full', SWATCH[z.key] ?? 'bg-chart-band')}></span>
				{i18n.pick(z.titles) || z.key}
			</li>
		{/each}
	</ul>
</div>
