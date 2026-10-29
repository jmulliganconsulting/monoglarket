<script lang="ts">
	import { marked } from 'marked';
	import changelog from '../../../CHANGELOG.md?raw';

	const REPO = 'https://github.com/jmulliganconsulting/monoglarket';

	// The site shows the short version: each release heading and the summary paragraph under it. CHANGELOG.md on GitHub has the detail.
	const tokens = marked.lexer(changelog);
	const entries = tokens.flatMap((t, i) => {
		const next = tokens.slice(i + 1).find((n) => n.type !== 'space');
		return t.type === 'heading' && t.depth === 2 && next?.type === 'paragraph'
			? [{ title: t.text, summary: marked.parseInline(next.text) as string }]
			: [];
	});
</script>

<svelte:head><title>Changelog · Monoglarket</title></svelte:head>

<article class="changelog">
	<h1>Changelog</h1>
	<p>Full changelog is available on <a href="{REPO}/blob/master/CHANGELOG.md">GitHub</a>.</p>
	{#each entries as entry (entry.title)}
		<section>
			<h2>{entry.title}</h2>
			<p>{@html entry.summary}</p>
		</section>
	{/each}
</article>

<style>
	.changelog {
		max-width: 760px;
		color: var(--fg-2);
		line-height: 1.6;
	}
	h1,
	h2 {
		color: var(--fg);
	}
	h2 {
		font-size: 1.125rem;
		margin-bottom: 0.25rem;
	}
	section p {
		margin-top: 0;
	}
</style>
