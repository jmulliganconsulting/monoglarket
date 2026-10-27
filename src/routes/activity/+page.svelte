<script lang="ts">
	import { coins, signedCoins } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const when = (d: Date) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
</script>

<svelte:head><title>Activity · Club Predictions</title></svelte:head>

<h1>Activity</h1>
<p class="meta">Your record: the markets you've traded, what you put in and what came back, and every change to your balance.</p>

<section>
	<h2>Markets</h2>
	{#if data.markets.length === 0}
		<p class="meta">You haven't traded yet.</p>
	{:else}
		<ul class="rows">
			{#each data.markets as m (m.marketId)}
				<li>
					<a href="/markets/{m.marketId}">{m.question}</a>
					<span class="meta">{m.result} · in {coins(m.stake)} {m.currency}{m.held.length ? ` · holding ${m.held.join(', ')}` : ''}</span>
					<span class="amt" class:up={m.profit > 0} class:down={m.profit < 0}>{signedCoins(m.profit)} {m.currency}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Every transaction</h2>
	{#if data.log.length === 0}
		<p class="meta">Nothing yet.</p>
	{:else}
		<ul class="rows">
			{#each data.log as t, i (i)}
				<li>
					<span>{t.text}</span>
					<span class="meta">{when(t.at)} · {t.kind}</span>
					<span class="amt" class:up={t.amount > 0} class:down={t.amount < 0}>{signedCoins(t.amount)} {t.currency}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	section {
		margin-bottom: 24px;
	}
	h2 {
		font-size: 1.125rem;
		margin: 0 0 8px;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 4px;
	}
	.rows li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.rows a {
		color: inherit;
		font-weight: var(--weight-strong);
	}
	.amt {
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-strong);
		text-align: right;
	}
	.up {
		color: var(--yes-text);
	}
	.down {
		color: var(--no-text);
	}
</style>
