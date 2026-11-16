<script lang="ts">
	// The paw mark, in the current text colour.
	let { class: className = 'size-5' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 120 120" class={className} fill="currentColor" aria-hidden="true">
	<ellipse cx="60" cy="86" rx="34" ry="27" />
	<ellipse cx="14" cy="50" rx="13" ry="17" />
	<ellipse cx="42" cy="22" rx="13" ry="18" />
	<ellipse cx="78" cy="22" rx="13" ry="18" />
	<ellipse cx="106" cy="50" rx="13" ry="17" />
</svg>
