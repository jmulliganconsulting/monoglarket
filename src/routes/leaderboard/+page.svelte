<script lang="ts">
	import { coins } from '#lib/format.ts';
	import Badge from '#lib/Badge.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = (params: Record<string, string>) => {
		const p = new URLSearchParams({ currency: data.current?.code ?? '', board: data.board, ...params });
		return `?${p.toString()}`;
	};
	const current = $derived(data.boards.find((b) => b.key === data.board)?.label ?? '');
</script>

<svelte:head><title>Leaderboard · Club Predictions</title></svelte:head>

<h1>Leaderboard</h1>
<p class="meta">{current}. Ranked by {data.unit}.</p>
{#if data.season && data.board === 'season'}
	<p class="meta">Season: {data.season.name}, counted from {new Date(data.season.startsAt).toLocaleDateString()}.</p>
{/if}

{#if data.currencies.length > 1}
	<nav class="tabs" aria-label="Currency">
		{#each data.currencies as c (c.code)}
			<a href={q({ currency: c.code })} aria-current={c.code === data.current?.code ? 'page' : undefined}>{c.name}</a>
		{/each}
	</nav>
{/if}
<nav class="tabs" aria-label="Board">
	{#each data.boards as b (b.key)}
		<a href={q({ board: b.key })} aria-current={b.key === data.board ? 'page' : undefined}>{b.label}</a>
	{/each}
</nav>

{#if data.rows.length === 0}
	<p class="meta">Nobody has a score here yet.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr><th scope="col">#</th><th scope="col">Member</th><th scope="col" class="num">{data.unit}</th></tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr>
						<td>{r.rank}</td>
						<td>
							<div class="member">
								{#if r.image}
									<img class="pfp" src="/sse-images/{r.image}" alt="" loading="lazy" />
								{:else}
									<span class="pfp initial" aria-hidden="true">{r.name.charAt(0)}</span>
								{/if}
								<span class="line">
									<a href="/users/{r.id}" style:color={r.colour}>{r.name}</a>
									{#if r.username}<span class="meta">@{r.username}</span>{/if}
									{#each r.badges.slice(0, 2) as b (b.label)}<Badge badge={b} compact />{/each}
								</span>
							</div>
						</td>
						<td class="num strong">{coins(r.value)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 12px;
	}
	.tabs a {
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
	.tabs a[aria-current='page'] {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: var(--card);
		border-radius: var(--radius-card);
	}
	th,
	td {
		padding: 10px 12px;
		text-align: left;
		border-bottom: 1px solid var(--border);
	}
	th {
		font-size: 0.8125rem;
		color: var(--muted);
		font-weight: var(--weight);
	}
	td a {
		color: inherit;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
	}
	.member {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.pfp {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}
	.initial {
		display: grid;
		place-items: center;
		background: var(--card-2);
		color: var(--muted);
		font-weight: var(--weight-strong);
	}
	/* Name, @username and the compact badges share one line; the badges sit to the right of the username. */
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 8px;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.strong {
		font-weight: var(--weight-strong);
	}
</style>
