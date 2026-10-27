<script lang="ts">
	import type { PageProps } from './$types';
	import { textOn } from '#lib/colour.ts';

	let { data }: PageProps = $props();
	const when = (d: Date | null) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
</script>

<svelte:head><title>History · Club Predictions</title></svelte:head>

<h1>History</h1>
<p class="meta">Every decided market, newest first: resolved, and cancelled with the reason.</p>
<nav class="chips" aria-label="Categories">
	<a href="/history" aria-current={data.category ? undefined : 'page'}>All</a>
	{#each data.categories as c (c.key)}
		<a href="?category={c.key}" aria-current={data.category === c.key ? 'page' : undefined} style:background={c.color} style:color={c.color ? textOn(c.color) : undefined}>{c.name}</a>
	{/each}
</nav>

{#if data.markets.length === 0}
	<p class="meta">No decided markets yet.</p>
{:else}
	<ul>
		{#each data.markets as m (m.id)}
			<li>
				<a href="/markets/{m.id}">{m.question}</a>
				<span class="meta">
					{#if m.status === 'cancelled'}Cancelled{m.cancelReason ? `: ${m.cancelReason}` : ''}{:else}Won by {m.winner ?? '?'}{/if}
					· {when(m.resolvedAt)}{m.category ? ` · ${m.category}` : ''}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 12px;
	}
	.chips a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		text-decoration: none;
		font-size: 0.875rem;
	}
	.chips a[aria-current='page'] {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 8px;
	}
	li {
		background: var(--card);
		border-radius: var(--radius-card);
		padding: 12px 16px;
		display: grid;
		gap: 4px;
	}
	li a {
		color: inherit;
		font-weight: var(--weight-strong);
	}
</style>
