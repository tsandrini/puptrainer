<script lang="ts">
	// The sign-in panel: shown instead of the pages when the API asks for
	// its access token.
	import { app } from '#lib/app.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import Paw from './Paw.svelte';

	let token = $state('');
	let wrong = $state(false);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		wrong = false;
		try {
			wrong = !(await app.signIn(token));
			if (!wrong) token = '';
		} catch {
			// NOTE: the shell's banner says when the API is away
		} finally {
			busy = false;
		}
	}
</script>

<form class="panel mx-auto mt-10 max-w-sm text-center" onsubmit={submit} data-testid="login">
	<Paw class="mx-auto size-10 text-primary" />
	<h1 class="mt-2 text-xl">{i18n.t.login.title}</h1>
	<p class="mt-1 text-sm text-muted-foreground">{i18n.t.login.prompt}</p>
	<Input
		class="mt-4"
		type="password"
		autocomplete="current-password"
		bind:value={token}
		placeholder={i18n.t.login.token}
		aria-label={i18n.t.login.token}
		required
	/>
	{#if wrong}
		<p class="mt-2 text-sm text-critical" role="alert">{i18n.t.login.wrong}</p>
	{/if}
	<Button type="submit" class="mt-4 w-full" disabled={busy}>{i18n.t.login.submit}</Button>
</form>
