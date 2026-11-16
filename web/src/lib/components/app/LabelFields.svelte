<script lang="ts">
	// The labels of a take, editable: what was spoken, in which language,
	// and which voice it was.
	import type { Intent, Item } from '#lib/api/types.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let {
		item = $bindable(),
		language = $bindable(),
		intent = $bindable(),
		idPrefix = 'labels'
	}: {
		item: Item;
		language: string | null;
		intent: Intent;
		idPrefix?: string;
	} = $props();

	const items: Item[] = ['vowels', 'glide', 'passage', 'free', 'other'];
	const intents: Intent[] = ['habitual', 'attempt'];
	const languages = ['en', 'cs'];
</script>

<div class="flex flex-wrap gap-2">
	<select class="select" bind:value={item} aria-label={i18n.t.takes.what} id="{idPrefix}-item">
		{#each items as value (value)}
			<option {value}>{i18n.t.item[value]}</option>
		{/each}
	</select>
	<select
		class="select"
		aria-label={i18n.t.common.language}
		id="{idPrefix}-language"
		value={language ?? ''}
		onchange={(event) => (language = event.currentTarget.value || null)}
	>
		<option value="">{i18n.t.common.anyLanguage}</option>
		{#each languages as value (value)}
			<option {value}>{i18n.language(value)}</option>
		{/each}
	</select>
	<select
		class="select"
		bind:value={intent}
		aria-label={i18n.t.intent.label}
		id="{idPrefix}-intent"
	>
		{#each intents as value (value)}
			<option {value}>{i18n.t.intent[value]}</option>
		{/each}
	</select>
</div>
