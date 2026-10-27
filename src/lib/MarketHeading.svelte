<script lang="ts">
	// A market's picture and its heading. A wide picture (twice as wide as it is tall, or more) runs as a banner above the heading.
	// Anything squarer is a logo, shown to the right of the heading.
	import type { Snippet } from 'svelte';
	let { src, children }: { src: string | null; children: Snippet } = $props();
	let banner = $state(false);
	const measure = (e: Event) => {
		const img = e.currentTarget as HTMLImageElement;
		banner = img.naturalWidth >= 2 * img.naturalHeight;
	};
</script>

{#if src && banner}
	<img class="banner" {src} alt="" onload={measure} />
	{@render children()}
{:else}
	<div class="row">
		{@render children()}
		{#if src}<img class="logo" {src} alt="" onload={measure} />{/if}
	</div>
{/if}

<style>
	.row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.row :global(h2) {
		flex: 1;
		min-width: 0;
	}
	.logo {
		width: 64px;
		height: 64px;
		flex: none;
		object-fit: contain;
		border-radius: 12px;
	}
	.banner {
		width: 100%;
		height: auto;
		max-height: 220px;
		object-fit: cover;
		border-radius: 12px;
	}
</style>
