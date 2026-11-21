<script lang="ts">
	// Which stretch of time a page looks at: quick ranges that move with the
	// clock ("30 days"), everything, or an exact from and to typed into the
	// browser's own date-time inputs (a phone brings its wheel, a desk its
	// calendar). An exact range is applied on purpose, and a pair that is no
	// range says why.
	import { Button } from '#lib/components/ui/button/index.js';
	import { toLocalInput } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { fromInput, rangeProblem, resolveRange, type TimeRange } from '#lib/range.js';
	import { cn } from '#lib/utils.js';

	let {
		value = $bindable({ kind: 'all' }),
		quick = [7, 30, 90],
		earliest = null
	}: {
		value?: TimeRange;
		/** Quick ranges offered, in days. */
		quick?: readonly number[];
		/** The oldest moment there is anything from, in ms: where "everything" starts. */
		earliest?: number | null;
	} = $props();

	let open = $state(false);
	let from = $state('');
	let to = $state('');
	/** Shown once Apply was refused; typing clears it. */
	let complained = $state(false);

	const problem = $derived(rangeProblem(fromInput(from), fromInput(to)));
	const stamp = (moment: number) =>
		new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-GB' : i18n.locale, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(moment));
	const summary = $derived(
		value.kind === 'all'
			? i18n.t.range.all
			: value.kind === 'quick'
				? i18n.t.range.last(value.days)
				: `${stamp(value.from)} – ${stamp(value.to)}`
	);

	/** The inputs start from what the page shows now. */
	function fill(): void {
		const now = Date.now();
		const span = resolveRange(value, now);
		from = toLocalInput(new Date(span.from ?? earliest ?? now - 30 * 86_400_000));
		to = toLocalInput(new Date(span.to ?? now));
		complained = false;
	}

	function apply(): void {
		const [start, end] = [fromInput(from), fromInput(to)];
		if (problem !== null || start === null || end === null) {
			complained = true;
			return;
		}
		value = { kind: 'absolute', from: start, to: end };
		open = false;
	}

	function pick(range: TimeRange): void {
		value = range;
		open = false;
	}
</script>

<div class="relative" data-testid="date-range" data-kind={value.kind}>
	<Button
		variant="outline"
		size="sm"
		aria-expanded={open}
		onclick={() => {
			if (!open) fill();
			open = !open;
		}}
		data-testid="date-range-open"
	>
		{i18n.t.range.label}: <span class="font-semibold">{summary}</span>
	</Button>
	{#if open}
		<div
			class="absolute right-0 z-30 mt-1 flex w-[min(92vw,30rem)] flex-col gap-4 rounded-lg border bg-popover p-3 shadow-md sm:flex-row"
			data-testid="date-range-panel"
		>
			<div class="flex flex-col gap-1 sm:w-36">
				<h3 class="text-xs font-semibold text-muted-foreground">{i18n.t.range.quick}</h3>
				{#each quick as days (days)}
					<Button
						variant={value.kind === 'quick' && value.days === days ? 'default' : 'ghost'}
						size="sm"
						class="justify-start"
						onclick={() => pick({ kind: 'quick', days })}
						data-quick={days}
					>
						{i18n.t.range.last(days)}
					</Button>
				{/each}
				<Button
					variant={value.kind === 'all' ? 'default' : 'ghost'}
					size="sm"
					class="justify-start"
					onclick={() => pick({ kind: 'all' })}
					data-quick="all"
				>
					{i18n.t.range.all}
				</Button>
			</div>
			<form
				class="flex flex-1 flex-col gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					apply();
				}}
			>
				<h3 class="text-xs font-semibold text-muted-foreground">{i18n.t.range.exact}</h3>
				{#each [['from', i18n.t.range.from], ['to', i18n.t.range.to]] as const as [which, label] (which)}
					<label class="flex flex-col gap-1 text-xs text-muted-foreground">
						{label}
						<input
							type="datetime-local"
							class="h-9 w-full rounded-md border bg-background px-2 font-mono text-sm text-foreground"
							value={which === 'from' ? from : to}
							oninput={(event) => {
								if (which === 'from') from = event.currentTarget.value;
								else to = event.currentTarget.value;
								complained = false;
							}}
							data-testid="date-range-{which}"
						/>
					</label>
				{/each}
				{#if complained && problem}
					<p class="text-xs text-critical" role="alert">{i18n.t.range.problems[problem]}</p>
				{/if}
				<div class="mt-1 flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="flex-1"
						onclick={() => {
							to = toLocalInput(new Date());
							complained = false;
						}}
					>
						{i18n.t.range.untilNow}
					</Button>
					<Button type="submit" size="sm" class={cn('flex-1')} data-testid="date-range-apply">
						{i18n.t.range.apply}
					</Button>
				</div>
			</form>
		</div>
	{/if}
</div>
