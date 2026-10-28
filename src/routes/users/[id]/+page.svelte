<script lang="ts">
	import { coins } from '#lib/format.ts';
	import Badge from '#lib/Badge.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const joined = (d: Date) => d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
	const hasRole = $derived(data.badges.some((b) => b.group === 'site' || b.group === 'official'));
</script>

<svelte:head><title>{data.name} · Monoglarket</title></svelte:head>

<header class="head">
	<div>
		<h1>{data.name}{#if data.seniority}<span class="seniority"><span class="dot">·</span>{data.seniority}</span>{/if}</h1>
		<p class="meta">
			{#if data.username}@{data.username}<span class="dot">·</span>{/if}{#if data.pronouns}{data.pronouns}<span class="dot">·</span>{/if}Joined {joined(data.joined)}
		</p>
	</div>
	<div class="corner">
		{#if data.isYou}<a class="edit" href="/account">Edit</a>{/if}
		{#if data.image}
			<img class="pfp" src="/sse-images/{data.image}" alt="" />
		{:else}
			<span class="pfp initial" aria-hidden="true">{data.name.charAt(0)}</span>
		{/if}
	</div>
</header>

<section class="card">
	<h2>Badges</h2>
	<ul class="badges" aria-label="Badges">
		{#if !hasRole}<li><Badge badge={{ label: 'Guest', group: 'official' }} /></li>{/if}
		{#each data.badges.filter((b) => b.group === 'official' || b.group === 'school') as b (b.label)}<li><Badge badge={b} /></li>{/each}
	</ul>
	<ul class="badges" aria-label="Site roles and achievements">
		{#each data.badges.filter((b) => b.group === 'site' || b.group === 'achievement') as b (b.label)}<li><Badge badge={b} /></li>{/each}
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
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 24px;
	}
	.head h1 {
		margin-bottom: 4px;
	}
	.head p {
		margin: 0;
	}
	.dot {
		margin: 0 8px;
	}
	.corner {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: none;
	}
	.edit {
		padding: 6px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		color: var(--fg);
		text-decoration: none;
		font-weight: var(--weight-strong);
	}
	.pfp {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
	}
	.initial {
		display: grid;
		place-items: center;
		background: var(--card-2);
		color: var(--muted);
		font-size: 1.5rem;
		font-weight: var(--weight-strong);
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
