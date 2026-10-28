<script lang="ts">
	import type { PageProps } from './$types';

	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { textOn } from '#lib/colour.ts';
	import { dateTime } from '#lib/format.ts';
	import MarketHeading from '#lib/MarketHeading.svelte';
	import { winningOptions } from '#lib/winners.ts';

	let { data, form }: PageProps = $props();
	// Live prices (vault "Live prices"): the cards start from the loaded data and follow the stream while the tab is visible.
	type Card = (typeof data.markets)[number];
	// svelte-ignore state_referenced_locally
	let cards = $state<Card[]>(structuredClone(data.markets));
	let connected = $state(false);
	$effect(() => {
		cards = structuredClone(data.markets);
	});
	// Two likeliest outcomes, as the cards show them (vault: Design reference).
	const topOf = (outs: Card['outcomes']) => outs.toSorted((a, b) => b.probability - a.probability).slice(0, 2);
	type Snap = { id: number; status: string; outcomes: { id: number; probability: number }[] };
	const apply = (snaps: Snap[]) => {
		const ids = new Set(cards.map((c) => c.id));
		// A market that left the list (resolved, cancelled) or a new one: reload the list.
		if (snaps.some((s) => !ids.has(s.id) || !['open', 'closed'].includes(s.status))) return void invalidateAll();
		for (const s of snaps) {
			const card = cards.find((c) => c.id === s.id);
			if (!card) continue;
			card.outcomes = card.outcomes.map((o) => ({ ...o, probability: s.outcomes.find((x) => x.id === o.id)?.probability ?? o.probability }));
		}
	};
	onMount(() => {
		let es: EventSource | null = null;
		const open = () => {
			if (es) return;
			es = new EventSource('/live/markets');
			es.addEventListener('snapshots', (e) => {
				connected = true;
				apply(JSON.parse((e as MessageEvent).data));
			});
			es.onerror = () => (connected = false);
		};
		const close = () => {
			es?.close();
			es = null;
			connected = false;
		};
		const onVisibility = () => (document.hidden ? close() : open());
		onVisibility();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			close();
		};
	});
	const closes = (d: Date | null) => (d ? `Closes ${dateTime(d)}` : 'No set close date');
	const pct = (p: number) => Math.round(p * 100);
	// Yes/No outcomes get green/red; others stay neutral (vault: Kalshi design reference).
	const side = (label: string) => ({ yes: 'yes', no: 'no' })[label.trim().toLowerCase()] ?? '';
	const yesOf = (m: Card) => m.outcomes.find((o) => o.label === 'Yes')?.probability ?? 0;
	// A decided question names what won: the option (for a date question, the earliest that held), or cancelled.
	const winnerText = (entry: Card[]) => {
		if (entry.every((m) => m.status === 'cancelled')) return 'Cancelled';
		const won = winningOptions(entry.map((m) => ({ label: m.optionLabel ?? m.question, won: m.winner === 'Yes', optionDate: m.optionDate })));
		return won.length ? `Won: ${won.map((o) => o.label).join(', ')}` : 'Decided';
	};
	// A question's picture is the first picture set on one of its options.
	const questionPicture = (entry: Card[]) => {
		const withPicture = entry.find((m) => m.imageFile);
		return withPicture ? `/market-images/${withPicture.imageFile}` : null;
	};
	// A question's options (several-winner or date) share one card, one row per option; every other market is a card of its own.
	const entriesOf = (list: Card[]) => {
		const out: Card[][] = [];
		const byGroup = new Map<number, Card[]>();
		for (const m of list) {
			if (m.questionGroupId === null) out.push([m]);
			else if (byGroup.has(m.questionGroupId)) byGroup.get(m.questionGroupId)!.push(m);
			else {
				const members = [m];
				byGroup.set(m.questionGroupId, members);
				out.push(members);
			}
		}
		return out;
	};
	// Markets grouped under their categories, in category order; uncategorised ones last. Live updates keep the groups.
	const groups = $derived(
		[...data.categories.map((c) => ({ name: c.name, list: cards.filter((m) => m.categoryKey === c.key) })), { name: 'Other', list: cards.filter((m) => !m.categoryKey) }].filter((g) => g.list.length),
	);
</script>

<svelte:head><title>MonoGlarket</title></svelte:head>

<h1>{data.decided ? 'Decided markets' : 'Open markets'}</h1>

<nav class="status" aria-label="Market status">
	<a href="/" aria-current={data.decided ? undefined : 'page'}>Open</a>
	<a href="/?tab=decided" aria-current={data.decided ? 'page' : undefined}>Decided</a>
</nav>
<nav class="chips" aria-label="Categories">
	<a class="all" href="/{data.decided ? '?tab=decided' : ''}" aria-current={data.category ? undefined : 'page'}>All</a>
	{#each data.categories as c (c.key)}
		<a href="?{data.decided ? 'tab=decided&' : ''}category={c.key}" aria-current={data.category === c.key ? 'page' : undefined} style:background={c.color} style:color={c.color ? textOn(c.color) : undefined}>{c.name}</a>
	{/each}
</nav>

{#if data.category && !data.decided && data.canModerate && data.markets.length}
	<form method="POST" action="?/setHeadliner" use:enhance class="pick">
		<label>Headliner
			<select name="marketId">
				{#each data.markets as m (m.id)}<option value={m.id} selected={m.id === data.headlinerId}>{m.question}</option>{/each}
			</select>
		</label>
		<button class="quiet">Set headliner</button>
		{#if form?.error}<span class="error" role="alert">{form.error}</span>{/if}
	</form>
{/if}

{#if data.markets.length === 0}
	<p class="empty">{data.decided ? 'No decided markets yet.' : 'No open markets yet.'}</p>
{:else}
	{#each groups as g (g.name)}
		{#if !data.category && data.categories.length}<h2 class="group">{g.name}</h2>{/if}
		<ul>
		{#each entriesOf(g.list) as entry (entry[0].id)}
			{#if entry[0].questionGroupId !== null}
				<li class="question" style:border-top={entry[0].colorPrimary ? `4px solid ${entry[0].colorPrimary}` : undefined}>
					<MarketHeading src={questionPicture(entry)}>
						<h2><a href="/questions/{entry[0].questionGroupId}">{entry[0].question}</a></h2>
					</MarketHeading>
					{#if data.decided}
						<p class="meta">{winnerText(entry)}{entry[0].resolvedAt ? `, ${closes(entry[0].resolvedAt)}` : ''}</p>
					{:else}
						<p class="meta">{closes(entry[0].closeAt)}</p>
					{/if}
					<p class="meta head" aria-hidden="true"><span>Option</span><span>Chance</span></p>
					{#each entry as o (o.id)}
						<div class="option">
							<a class="option-name" href="/markets/{o.id}">{o.optionLabel}</a>
							<span class="pill" aria-label="{pct(yesOf(o))}% chance">{pct(yesOf(o))}%</span>
							{#if data.decided}
								<span class="meta">{o.status === 'cancelled' ? 'Cancelled' : o.winner === 'Yes' ? 'Won' : 'Lost'}</span>
							{:else}
								<a class="choice yes" href="/markets/{o.id}">Yes {pct(yesOf(o))}%</a>
								<a class="choice no" href="/markets/{o.id}">No {pct(1 - yesOf(o))}%</a>
							{/if}
						</div>
					{/each}
				</li>
			{:else}
				{@const m = entry[0]}
				<li class:headliner={m.id === data.headlinerId} style:border-top={m.colorPrimary ? `4px solid ${m.colorPrimary}` : undefined}>
					{#if m.id === data.headlinerId}<p class="tag">Headliner</p>{/if}
					<MarketHeading large={m.id === data.headlinerId} src={m.imageFile ? `/market-images/${m.imageFile}` : null}>
						<h2><a href="/markets/{m.id}">{m.question}</a></h2>
					</MarketHeading>
					{#if data.decided}
						<p class="meta">{m.status === 'cancelled' ? 'Cancelled' : `Won by ${m.winner ?? '?'}`}{m.resolvedAt ? `, ${closes(m.resolvedAt)}` : ''}</p>
					{:else}
						<p class="meta">{closes(m.closeAt)}</p>
					{/if}
					<p class="meta head" aria-hidden="true"><span>Outcome</span><span>Chance</span></p>
					{#each topOf(m.outcomes) as o (o.label)}
						<div class="outcome {side(o.label)}">
							<span class="label">
								{o.label}
								<span class="bar" style:width="{pct(o.probability)}%"></span>
							</span>
							<span class="pill" aria-label="{pct(o.probability)}% chance">{pct(o.probability)}%</span>
						</div>
					{/each}
					{#if m.outcomes.length > 2}
						<p class="meta">{m.outcomes.length} outcomes</p>
					{/if}
				</li>
			{/if}
		{/each}
		</ul>
	{/each}
{/if}

<style>
	/* Market card: vault examples/Design reference, "Market card". */
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: 16px;
	}
	li {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		display: grid;
		gap: 12px;
	}
	h2 a {
		color: inherit;
		text-decoration: none;
	}
	h2 {
		font-size: 0.9375rem;
		line-height: 1.33;
		font-weight: var(--weight-strong);
		margin: 0;
	}
	p {
		margin: 0;
	}
	.pic {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 12px;
	}
	.status,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
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
	}
	/* Coloured tabs keep their colour when selected; the ring shows which one is open. */
	.chips a[aria-current='page'] {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	/* Status is text tabs on a divider line, so it doesn't read as category buttons. */
	.status {
		gap: 24px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}
	.chips {
		margin-bottom: 20px;
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 8px;
		margin-bottom: 20px;
		font-size: 0.875rem;
	}
	.pick select {
		min-height: 44px;
		max-width: 100%;
	}
	.headliner {
		grid-column: 1 / -1;
	}
	.tag {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: var(--weight-strong);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.status a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		margin-bottom: -1px; /* the active underline sits on the divider */
		padding: 0 2px;
		color: var(--muted);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.status a[aria-current='page'] {
		color: var(--fg);
		border-bottom-color: var(--fg);
		font-weight: var(--weight-strong);
	}
	/* Space between All and the categories. */
	.all {
		margin-right: 16px;
	}
	.group {
		margin: 24px 0 0;
		font-size: 1.125rem;
	}
	.meta,
	.empty {
		color: var(--muted);
		font-size: 0.875rem;
		letter-spacing: -0.1px;
	}
	h2 + .meta {
		margin-top: -10px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		margin-bottom: -6px;
	}
	.head span:last-child {
		min-width: 60px;
		text-align: center;
	}
	.outcome {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.label {
		flex: 1;
		display: grid;
		gap: 4px;
	}
	/* Bar length is the probability. */
	.bar {
		height: 2px;
		border-radius: 100px;
		background: var(--fg-2);
		max-width: 100%;
	}
	.yes .bar {
		background: var(--yes);
	}
	.no .bar {
		background: var(--no);
	}
	.yes .pill {
		color: var(--yes-text);
	}
	.no .pill {
		color: var(--no-text);
	}
	.pill {
		min-width: 60px;
		height: 44px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
		font-variant-numeric: tabular-nums;
	}
	/* A question card: one row per option, name and chance on the left, Yes and No on the right (like the Polymarket date market). */
	.option {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		align-items: center;
		gap: 8px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}
	.option-name {
		color: var(--fg);
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		text-decoration: none;
	}
	.choice {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		padding: 0 10px;
		border-radius: 12px;
		background: var(--card-2);
		font-size: 0.8125rem;
		font-weight: var(--weight-strong);
		white-space: nowrap;
		text-decoration: none;
	}
	.choice.yes {
		color: var(--yes-text);
	}
	.choice.no {
		color: var(--no-text);
	}
</style>
