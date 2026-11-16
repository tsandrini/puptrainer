<script lang="ts">
	// Import of existing recordings: the labels are guessed from the file
	// names and can be corrected before the files go through the upload queue.
	import { goto } from '$app/navigation';
	import type { Intent, Item } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import Empty from '#lib/components/app/Empty.svelte';
	import LabelFields from '#lib/components/app/LabelFields.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { toLocalInput } from '#lib/format.js';
	import { i18n } from '#lib/i18n/index.svelte.js';
	import { guessLabels, passageFor, passageRef } from '#lib/labels.js';
	import { queue } from '#lib/queue.svelte.js';

	type Row = {
		file: File;
		item: Item;
		language: string | null;
		intent: Intent;
		recordedAt: string;
	};

	let rows = $state<Row[]>([]);
	let deviceId = $state<number | null>(null);
	let busy = $state(false);
	let done = $state<number | null>(null);

	const device = $derived(app.devices.find((d) => d.id === deviceId) ?? app.devices[0] ?? null);

	/** The file's own time, unless its name carries another day: then noon of that day. */
	function recordedAt(file: File, date: string | null): string {
		const modified = new Date(file.lastModified);
		if (!date || toLocalInput(modified).startsWith(date)) return toLocalInput(modified);
		return `${date}T12:00`;
	}

	function choose(event: Event & { currentTarget: HTMLInputElement }) {
		const passages = app.content?.passages ?? [];
		const added = [...(event.currentTarget.files ?? [])].map((file) => {
			const guess = guessLabels(file.name, passages);
			return {
				file,
				item: guess.item,
				language: guess.language,
				intent: guess.intent,
				recordedAt: recordedAt(file, guess.date)
			};
		});
		rows = [...rows, ...added];
		done = null;
		event.currentTarget.value = '';
	}

	async function importAll() {
		if (!device) return;
		busy = true;
		const count = rows.length;
		try {
			for (const row of rows) {
				const passage =
					row.item === 'passage' ? passageFor(app.content?.passages ?? [], row.language) : null;
				await queue.add(await row.file.arrayBuffer(), row.file.type || 'audio/wav', row.file.name, {
					device_id: device.id,
					item: row.item,
					intent: row.intent,
					language: row.language,
					content_ref: passage ? passageRef(passage) : null,
					recorded_at: new Date(row.recordedAt).toISOString()
				});
			}
			rows = [];
			done = count;
			if (queue.items.length === 0) await goto('/');
		} finally {
			busy = false;
		}
	}
</script>

<h1 class="mb-2 text-2xl">{i18n.t.import.title}</h1>
<p class="mb-4 text-sm text-muted-foreground">{i18n.t.import.intro}</p>

{#if !app.loaded}
	<p class="text-muted-foreground">{i18n.t.common.loading}</p>
{:else if app.devices.length === 0}
	<Empty text={i18n.t.record.needDevice}>
		<Button href="/devices">{i18n.t.record.addDevice}</Button>
	</Empty>
{:else}
	<div class="panel flex flex-wrap items-end gap-3">
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.record.setup}</span>
			<select
				class="select"
				value={device?.id}
				onchange={(event) => (deviceId = Number(event.currentTarget.value))}
			>
				{#each app.devices as option (option.id)}
					<option value={option.id}>{option.name}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm">
			<span class="mb-1 block text-muted-foreground">{i18n.t.import.choose}</span>
			<input
				class="block text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
				type="file"
				accept=".wav,.flac,audio/wav,audio/x-wav,audio/flac"
				multiple
				onchange={choose}
				data-testid="files"
			/>
		</label>
	</div>

	{#if done !== null}
		<p class="mt-4 text-sm text-muted-foreground" role="status">{i18n.t.import.done(done)}</p>
	{/if}

	{#if rows.length}
		<div class="panel mt-4 p-0">
			<Table.Root data-testid="import-rows">
				<Table.Header>
					<Table.Row>
						<Table.Head>{i18n.t.import.file}</Table.Head>
						<Table.Head>{i18n.t.take.labels}</Table.Head>
						<Table.Head>{i18n.t.import.date}</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row, index (row.file)}
						<Table.Row>
							<Table.Cell class="font-mono text-xs">{row.file.name}</Table.Cell>
							<Table.Cell>
								<LabelFields
									bind:item={row.item}
									bind:language={row.language}
									bind:intent={row.intent}
									idPrefix="row-{index}"
								/>
							</Table.Cell>
							<Table.Cell>
								<Input type="datetime-local" class="w-auto" bind:value={row.recordedAt} />
							</Table.Cell>
							<Table.Cell>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => (rows = rows.filter((r) => r !== row))}
								>
									{i18n.t.import.remove}
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		<Button class="mt-4" disabled={busy} onclick={importAll} data-testid="import-all">
			{i18n.t.import.importAll(rows.length)}
		</Button>
	{/if}
{/if}
