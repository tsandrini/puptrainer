<script lang="ts">
	// The people whose voices are here. One of them is the default person:
	// the one who trains with the app, whose everyday voice is the baseline
	// of every reading. Others are added to keep their takes apart: a
	// friend's voice to compare with, never mixed into the default person's
	// numbers. Deleting a person deletes their recordings with them.
	import { ApiError } from '#lib/api/client.js';
	import { createPerson, deletePerson, makeDefaultPerson, updatePerson } from '#lib/api/index.js';
	import type { PersonOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import Help from '#lib/components/app/Help.svelte';
	import PersonMark from '#lib/components/app/PersonMark.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { shapeOf } from '#lib/people.js';
	import { taking } from '#lib/people.svelte.js';

	let editing = $state<number | 'new' | null>(null);
	let name = $state('');
	let note = $state('');
	let error = $state<string | null>(null);

	function edit(person: PersonOut | null) {
		editing = person?.id ?? 'new';
		name = person?.name ?? '';
		note = person?.note ?? '';
		error = null;
	}

	function cancel() {
		editing = null;
		error = null;
	}

	/** Run a change and say why when the API refuses it. */
	async function act(work: () => Promise<void>) {
		error = null;
		try {
			await work();
		} catch (e) {
			error = e instanceof ApiError ? e.message : String(e);
		}
	}

	const save = (event: SubmitEvent) => {
		event.preventDefault();
		return act(async () => {
			if (editing === 'new') await createPerson({ name, note });
			else if (editing !== null) await updatePerson(editing, { name, note });
			await app.refreshPeople();
			editing = null;
		});
	};

	const makeDefault = (person: PersonOut) =>
		act(async () => {
			if (!confirm(i18n.t.people.confirmDefault(person.name))) return;
			app.people = await makeDefaultPerson(person.id);
			// NOTE: the Record page goes back to the default person, whoever that is now
			taking.id = null;
		});

	const remove = (person: PersonOut) =>
		act(async () => {
			// NOTE: counted afresh: a take may have been recorded since the list was read
			await app.refreshPeople();
			const takes = app.person(person.id)?.take_count ?? 0;
			if (!confirm(i18n.t.people.confirmDelete(person.name, takes))) return;
			await deletePerson(person.id, takes > 0);
			if (taking.id === person.id) taking.id = null;
			await app.refreshPeople();
		});
</script>

<div class="mb-2 flex items-center gap-2">
	<h1 class="text-2xl">{i18n.t.people.title}</h1>
	<Help title={i18n.t.people.title} text={i18n.t.people.help} wide />
	{#if editing === null}
		<Button class="ml-auto" onclick={() => edit(null)} data-testid="person-add">
			{i18n.t.people.add}
		</Button>
	{/if}
</div>
<p class="mb-4 text-sm text-muted-foreground">{i18n.t.people.intro}</p>

{#snippet form()}
	<form class="panel space-y-3" onsubmit={save} data-testid="person-form">
		<Input
			class="max-w-xs"
			bind:value={name}
			placeholder={i18n.t.people.name}
			aria-label={i18n.t.people.name}
			required
			maxlength={80}
		/>
		<Textarea
			bind:value={note}
			rows={2}
			placeholder={i18n.t.people.notePlaceholder}
			aria-label={i18n.t.people.note}
		/>
		<div class="flex gap-2">
			<Button type="submit" size="sm">{i18n.t.common.save}</Button>
			<Button variant="ghost" size="sm" onclick={cancel}>
				{i18n.t.common.cancel}
			</Button>
		</div>
	</form>
{/snippet}

{#if error}
	<p
		class="mb-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm"
		role="alert"
		data-testid="people-problem"
	>
		{error}
	</p>
{/if}

{#if editing === 'new'}
	<div class="mb-4">{@render form()}</div>
{/if}

<ul class="space-y-2" data-testid="people">
	{#each app.people as person (person.id)}
		<li data-person={person.id}>
			{#if editing === person.id}
				{@render form()}
			{:else}
				<div class="panel flex flex-wrap items-start gap-3">
					<div class="min-w-0 flex-1">
						<p class="flex flex-wrap items-center gap-2 font-bold">
							<PersonMark shape={shapeOf(app.people, person.id)} class="text-primary" />
							{person.name}
							{#if person.is_default}
								<Badge title={i18n.t.people.defaultHint} data-testid="person-default">
									{i18n.t.people.default}
								</Badge>
							{/if}
							<a
								class="text-sm font-normal text-muted-foreground underline-offset-2 hover:underline"
								href="/?who={person.id}"
							>
								{i18n.t.people.takes(person.take_count)}
							</a>
						</p>
						{#if person.note}
							<p class="mt-1 text-sm whitespace-pre-line text-muted-foreground">{person.note}</p>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						{#if !person.is_default}
							<Button
								variant="outline"
								size="sm"
								onclick={() => makeDefault(person)}
								data-testid="person-make-default"
							>
								{i18n.t.people.makeDefault}
							</Button>
						{/if}
						<Button variant="outline" size="sm" onclick={() => edit(person)}>
							{i18n.t.common.edit}
						</Button>
						{#if !person.is_default}
							<Button
								variant="destructive"
								size="sm"
								onclick={() => remove(person)}
								data-testid="person-delete"
							>
								{i18n.t.common.delete}
							</Button>
						{/if}
					</div>
				</div>
			{/if}
		</li>
	{/each}
</ul>
