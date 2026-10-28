<script lang="ts">
	import { marked } from 'marked';
	import privacy from '../../../docs/legal/privacy-policy.md?raw';

	// The docs link to each other as files; on the site they are routes.
	const html = marked.parse(privacy.replace(/\(terms-of-service\.md\)/g, '(/terms)')) as string;
</script>

<svelte:head><title>Privacy Policy · MonoGlarket</title></svelte:head>

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
	.legal :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.legal :global(th),
	.legal :global(td) {
		text-align: left;
		padding: 6px 8px;
		border-bottom: 1px solid var(--line, #ddd);
		vertical-align: top;
	}
</style>
