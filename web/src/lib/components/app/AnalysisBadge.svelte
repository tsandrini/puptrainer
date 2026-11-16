<script lang="ts">
	// Where a take's analysis stands.
	import type { AnalysisOut } from '#lib/api/types.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { i18n } from '#lib/i18n/index.svelte.js';

	let { analysis }: { analysis: AnalysisOut | null } = $props();

	const variant = $derived(
		analysis?.status === 'failed'
			? 'destructive'
			: analysis?.status === 'done'
				? 'secondary'
				: 'outline'
	);
</script>

<Badge {variant} data-status={analysis?.status ?? 'none'}>
	{analysis ? i18n.t.analysis[analysis.status] : i18n.t.analysis.none}
</Badge>
