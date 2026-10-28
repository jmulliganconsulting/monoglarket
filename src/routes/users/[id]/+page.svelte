<script lang="ts">
	import { coins } from '#lib/format.ts';
	import Badge from '#lib/Badge.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const joined = (d: Date) => d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
	const hasRole = $derived(data.badges.some((b) => b.group === 'site' || b.group === 'official'));
</script>

<svelte:head><title>{data.name} · MonoGlarket</title></svelte:head>

<header class="head">
	<h1>{data.name}{#if data.seniority}<span class="seniority"> · {data.seniority}</span>{/if}</h1>
	<p class="meta">
		{#if data.username}@{data.username} · {/if}{#if data.pronouns}{data.pronouns} · {/if}Joined {joined(data.joined)}
		{#if data.isYou}· <a href="/account">This is you. Edit your account</a>{/if}
	</p>
</header>

<section class="card">
	<h2>Badges</h2>
	<ul class="badges" aria-label="Badges">
		{#if !hasRole}<li><Badge badge={{ label: 'Guest', group: 'official' }} /></li>{/if}
		{#each data.badges as b (b.label)}<li><Badge badge={b} /></li>{/each}
	</ul>
</section>

<section class="card">
	<h2>Record</h2>
	<p>{data.stats.trades} trades across {data.stats.markets} markets.</p>
</section>

<section class="card">
	<h2>Open positions</h2>
	{#if data.positions.length === 0}
		<p class="meta">No positions.</p>
	{:else}
		<ul class="plain">
			{#each data.positions as p (p.marketId + p.outcome)}
				<li><a href="/markets/{p.marketId}">{p.question}</a>: {p.shares.toFixed(2)} “{p.outcome}” <span class="meta">{p.status}</span></li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Recent trades</h2>
	{#if data.trades.length === 0}
		<p class="meta">No trades yet.</p>
	{:else}
		<ul class="plain">
			{#each data.trades as t (t.id)}
				<li>
					<span><a href="/markets/{t.marketId}">{t.question}</a>: {t.shares > 0 ? 'bought' : 'sold'} {Math.abs(t.shares).toFixed(2)} “{t.outcome}” for {coins(t.amount)} {t.currency}</span>
					<span class="meta">{when(t.createdAt)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.head h1 {
		margin-bottom: 4px;
	}
	.head p {
		margin: 0;
	}
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		margin-bottom: 12px;
	}
	.card h2 {
		font-size: 1.125rem;
		margin: 0 0 8px;
	}
	.card p {
		margin: 0 0 8px;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.badges {
		list-style: none;
		padding: 0;
		margin: 0 0 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.seniority {
		color: var(--muted);
		font-weight: var(--weight);
	}
	.plain {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 8px;
	}
	.plain li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
	}
	.plain a {
		color: inherit;
	}
</style>
