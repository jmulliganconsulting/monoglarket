<script lang="ts">
	import { marked } from 'marked';
	import rules from '../../../docs/rules/market-rules.md?raw';

	const html = marked.parse(rules) as string;
</script>

<svelte:head><title>Market Rules · Monoglarket</title></svelte:head>

<article class="legal">{@html html}</article>

<style>
	.legal {
		max-width: 760px;
		color: var(--fg-2);
		line-height: 1.6;
	}
	.legal :global(h1) {
		color: var(--fg);
	}
</style>
