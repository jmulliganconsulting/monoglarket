<script lang="ts">
	import { coins, signedCoins } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import { SELL_FEE } from '../../engine/fees.ts';

	let { data }: PageProps = $props();
	const feePct = Math.round(SELL_FEE * 100);
	const when = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
</script>

<svelte:head><title>Portfolio · Club Predictions</title></svelte:head>

<h1>Portfolio</h1>

<section class="balances">
	{#each data.balances as b (b.code)}
		<div class="card">
			<p class="meta">{b.name}</p>
			<p class="big"><img class="coin" src="/sse-coin.svg" alt="" width="32" height="32" />{coins(b.balance)}<span class="unit"> {b.code}</span></p>
		</div>
	{:else}
		<div class="card"><p class="meta">No balance yet. Your signup grant appears after sign-in.</p></div>
	{/each}
</section>

<section>
	<h2>Open positions</h2>
	{#if data.positions.length === 0}
		<p class="meta">No shares held. <a href="/">Browse open markets</a>.</p>
	{:else}
		<ul class="list">
			{#each data.positions as p (p.marketId + p.outcome)}
				<li class="card">
					<a href="/markets/{p.marketId}">{p.question}</a>
					<p class="meta">{p.shares.toFixed(2)} “{p.outcome}” · {coins(p.netSpent)} {p.currency} in · {p.status}</p>
					<p>Worth {coins(p.worth)} {p.currency} now{p.status === 'open' || p.status === 'closed' ? ` after the ${feePct}% sale fee` : ''},<span class:gain={p.worth - p.netSpent > 0} class:loss={p.worth - p.netSpent < 0}>{signedCoins(p.worth - p.netSpent)}</span></p>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>History</h2>
	{#if data.trades.length === 0}
		<p class="meta">No trades yet.</p>
	{:else}
		<ul class="list">
			{#each data.trades as t (t.id)}
				<li class="row">
					<span>
						<a href="/markets/{t.marketId}">{t.question}</a>
						<span class="meta">{t.shares > 0 ? 'Bought' : 'Sold'} {Math.abs(t.shares).toFixed(2)} “{t.outcome}” for {coins(t.amount)} {t.currency}</span>
					</span>
					<span class="meta">{when(t.createdAt)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h2>Balance changes</h2>
	{#if data.adjustments.length === 0}
		<p class="meta">No changes by an administrator.</p>
	{:else}
		<ul class="plain">
			{#each data.adjustments as a (a.id)}
				<li><span>{a.reason}</span> <span class="amt">{signedCoins(a.amount)} {a.code}</span></li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		margin-bottom: 24px;
	}
	h2 {
		font-size: 1.125rem;
		margin: 0 0 12px;
	}
	.balances {
		display: grid;
		gap: 12px;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	}
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		display: grid;
		gap: 4px;
		margin: 0;
	}
	.card p {
		margin: 0;
	}
	.big {
		font-size: 1.75rem;
		font-weight: var(--weight-strong);
		font-variant-numeric: tabular-nums;
	}
	.coin {
		vertical-align: -0.3em;
		margin-right: 6px;
	}
	.unit {
		font-size: 0.875rem;
		color: var(--muted);
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}
	.list a {
		color: inherit;
		font-weight: var(--weight-strong);
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.row > span:first-child {
		display: grid;
		gap: 2px;
	}
	.gain {
		color: var(--yes-text);
	}
	.loss {
		color: var(--no-text);
	}
</style>
