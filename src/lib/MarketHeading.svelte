<script lang="ts">
	// A market's picture and its heading. A wide picture (twice as wide as it is tall, or more) runs as a banner above the heading.
	// Anything squarer is a logo, shown to the right of the heading.
	import type { Snippet } from 'svelte';
	// large: the market page shows the picture bigger than the lists do.
	let { src, large = false, children }: { src: string | null; large?: boolean; children: Snippet } = $props();
	let banner = $state(false);
	const measure = (e: Event) => {
		const img = e.currentTarget as HTMLImageElement;
		banner = img.naturalWidth >= 2 * img.naturalHeight;
	};
</script>

{#if src && banner}
	<img class={['h-auto w-full rounded-xl object-cover', large ? 'max-h-[380px]' : 'max-h-[220px]']} {src} alt="" onload={measure} />
	{@render children()}
{:else}
	<div class="flex items-start gap-3 [&_h2]:min-w-0 [&_h2]:flex-1">
		{@render children()}
		<!-- "logo" is a hook only: the market page pins the large logo to its header's edge. -->
		{#if src}<img class={['logo flex-none object-contain', large ? 'size-32 rounded-2xl' : 'size-16 rounded-xl']} {src} alt="" onload={measure} />{/if}
	</div>
{/if}

