<script lang="ts">
	// The microphone setups: one per microphone and placement, since takes
	// are only comparable within a setup.
	import { ApiError } from '#lib/api/client.js';
	import { createDevice, updateDevice } from '#lib/api/index.js';
	import type { DeviceKind, DeviceOut } from '#lib/api/types.js';
	import { app } from '#lib/app.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	const kinds: DeviceKind[] = ['lavalier', 'headset', 'desktop', 'laptop', 'phone', 'other'];

	let editing = $state<number | 'new' | null>(null);
	let name = $state('');
	let kind = $state<DeviceKind>('lavalier');
	let note = $state('');
	let error = $state<string | null>(null);

	function edit(device: DeviceOut | null) {
		editing = device?.id ?? 'new';
		name = device?.name ?? '';
		kind = device?.kind ?? 'lavalier';
		note = device?.note ?? '';
		error = null;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		try {
			const body = { name, kind, note };
			if (editing === 'new') await createDevice(body);
			else if (editing !== null) await updateDevice(editing, body);
			await app.refreshDevices();
			editing = null;
		} catch (e) {
			error = e instanceof ApiError ? e.message : String(e);
		}
	}
</script>

<div class="mb-2 flex items-center gap-2">
	<h1 class="mr-auto text-xl font-semibold">{i18n.t.devices.title}</h1>
	{#if editing === null}
		<Button onclick={() => edit(null)}>{i18n.t.devices.add}</Button>
	{/if}
</div>
<p class="mb-4 text-sm text-muted-foreground">{i18n.t.devices.intro}</p>

{#snippet form()}
	<form class="space-y-3 rounded-lg border p-4" onsubmit={save}>
		<div class="flex flex-wrap gap-2">
			<Input
				class="max-w-xs"
				bind:value={name}
				placeholder={i18n.t.devices.name}
				aria-label={i18n.t.devices.name}
				required
				maxlength={80}
			/>
			<select class="select" bind:value={kind} aria-label={i18n.t.devices.kind}>
				{#each kinds as value (value)}
					<option {value}>{i18n.t.devices.kinds[value]}</option>
				{/each}
			</select>
		</div>
		<Textarea
			bind:value={note}
			rows={2}
			placeholder={i18n.t.devices.notePlaceholder}
			aria-label={i18n.t.devices.note}
		/>
		{#if error}
			<p class="text-sm text-critical" role="alert">{error}</p>
		{/if}
		<div class="flex gap-2">
			<Button type="submit" size="sm">{i18n.t.common.save}</Button>
			<Button variant="ghost" size="sm" onclick={() => (editing = null)}>
				{i18n.t.common.cancel}
			</Button>
		</div>
	</form>
{/snippet}

{#if editing === 'new'}
	<div class="mb-4">{@render form()}</div>
{/if}

{#if app.loaded && app.devices.length === 0 && editing === null}
	<p class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
		{i18n.t.devices.empty}
	</p>
{/if}

<ul class="space-y-2" data-testid="devices">
	{#each app.devices as device (device.id)}
		<li>
			{#if editing === device.id}
				{@render form()}
			{:else}
				<div class="flex items-start gap-3 rounded-lg border p-4">
					<div class="flex-1">
						<p class="font-medium">
							{device.name}
							<span class="font-normal text-muted-foreground">
								· {i18n.t.devices.kinds[device.kind]}
							</span>
						</p>
						{#if device.note}
							<p class="mt-1 text-sm whitespace-pre-line text-muted-foreground">{device.note}</p>
						{/if}
					</div>
					<Button variant="outline" size="sm" onclick={() => edit(device)}>
						{i18n.t.common.edit}
					</Button>
				</div>
			{/if}
		</li>
	{/each}
</ul>
