<script lang="ts">
	// One tap for how a rep or a session felt: 1 strained … 5 effortless.
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	let { value = null, onpick }: { value?: number | null; onpick: (comfort: number) => void } =
		$props();
</script>

<div class="grid grid-cols-5 gap-1.5" role="group" aria-label={i18n.t.practice.run.comfort}>
	{#each i18n.t.practice.run.comforts as label, index (index)}
		{@const comfort = index + 1}
		<button
			type="button"
			class={cn(
				'flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-xs font-semibold transition-colors',
				value === comfort
					? 'border-primary bg-primary text-primary-foreground'
					: 'bg-card hover:bg-accent'
			)}
			aria-pressed={value === comfort}
			data-testid="comfort-{comfort}"
			onclick={() => onpick(comfort)}
		>
			<span class="text-lg font-black tabular-nums">{comfort}</span>
			<span class="leading-tight">{label}</span>
		</button>
	{/each}
</div>
