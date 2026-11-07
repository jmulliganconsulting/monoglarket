<script lang="ts">
	// Time zone picker for dates and times typed into a form: the viewer's own zone by default, or UTC, or any other.
	import { onMount } from 'svelte';
	import { localZone, zones } from '../markets/when.ts';

	let { value = $bindable(''), name = 'tz' }: { value?: string; name?: string } = $props();
	const all = zones();
	// The server doesn't know the viewer's zone, so it is filled in once the page runs in their browser.
	onMount(() => {
		if (!value) value = localZone();
	});
</script>

<label>
	Time zone
	<select {name} bind:value>
		{#if !value}<option value="">…</option>{/if}
		{#each all as z (z)}<option value={z}>{z === 'UTC' ? 'UTC' : z.replaceAll('_', ' ')}</option>{/each}
	</select>
</label>
