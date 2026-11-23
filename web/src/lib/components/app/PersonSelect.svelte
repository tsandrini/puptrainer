<script lang="ts">
	// Whose voice a take is: the people as a select, the default person first.
	import { app } from '#lib/app.svelte.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { cn } from '#lib/utils.js';

	let {
		value = $bindable(),
		disabled = false,
		id,
		testid,
		class: className
	}: {
		/** The person's id; without one the default person is shown. */
		value: number | null;
		disabled?: boolean;
		id?: string;
		testid?: string;
		class?: string;
	} = $props();
</script>

<select
	class={cn('select', className)}
	{id}
	{disabled}
	aria-label={i18n.t.people.whose}
	value={value ?? app.me?.id}
	onchange={(event) => (value = Number(event.currentTarget.value))}
	data-testid={testid}
>
	{#each app.people as person (person.id)}
		<option value={person.id}>
			{person.name}{person.is_default ? ` (${i18n.t.people.default})` : ''}
		</option>
	{/each}
</select>
