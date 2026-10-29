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

	// Market card: vault examples/Design reference, "Market card". Shared classes for the cards below.
	const card = 'grid gap-3 rounded-card bg-card p-4 shadow-card';
	const title = 'm-0 text-[0.9375rem] leading-[1.33] font-strong [&_a]:text-inherit [&_a]:no-underline';
	const meta = 'm-0 text-sm tracking-[-0.1px] text-muted';
	const head = `${meta} -mb-1.5 flex justify-between text-xs [&>:last-child]:min-w-[60px] [&>:last-child]:text-center`;
	// The chance is the loudest thing on the card.
	const pill = 'grid h-11 min-w-[60px] place-items-center rounded-pill bg-card-2 font-display text-[1.375rem] font-[650] tabular-nums [font-stretch:var(--stretch-display)]';
	const sideText = { yes: 'text-yes-text', no: 'text-no-text' } as Record<string, string>;
	const sideBar = { yes: 'bg-yes', no: 'bg-no' } as Record<string, string>;
	const choice = 'inline-flex min-h-11 items-center rounded-xl bg-card-2 px-2.5 text-[0.8125rem] font-strong whitespace-nowrap no-underline';

</script>

<svelte:head><title>Monoglarket</title></svelte:head>

<h1>{data.decided ? 'Decided markets' : 'Open markets'}</h1>

<!-- Status is text tabs on a divider line, so it doesn't read as category buttons. The active underline sits on the divider. -->
<nav class="mb-4 flex flex-wrap gap-6 border-b border-border" aria-label="Market status">
	{#each [{ href: '/', text: 'Open', on: !data.decided }, { href: '/?tab=decided', text: 'Decided', on: data.decided }] as t (t.href)}
		<a class="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-0.5 text-muted no-underline aria-[current=page]:border-fg aria-[current=page]:font-strong aria-[current=page]:text-fg" href={t.href} aria-current={t.on ? 'page' : undefined}>{t.text}</a>
	{/each}
</nav>
<!-- Coloured tabs keep their colour when selected; the ring shows which one is open. All sits apart from the categories. -->
<nav class="mb-5 flex flex-wrap gap-2 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center [&>a]:rounded-pill [&>a]:bg-card-2 [&>a]:px-3.5 [&>a]:text-sm [&>a]:text-fg [&>a]:no-underline [&>a[aria-current=page]]:bg-fg [&>a[aria-current=page]]:font-strong [&>a[aria-current=page]]:text-bg [&>a[aria-current=page]]:outline-2 [&>a[aria-current=page]]:outline-offset-2 [&>a[aria-current=page]]:outline-fg" aria-label="Categories">
	<a class="mr-4" href="/{data.decided ? '?tab=decided' : ''}" aria-current={data.category ? undefined : 'page'}>All</a>
	{#each data.categories as c (c.key)}
		<a href="?{data.decided ? 'tab=decided&' : ''}category={c.key}" aria-current={data.category === c.key ? 'page' : undefined} style:background={c.color} style:color={c.color ? textOn(c.color) : undefined}>{c.name}</a>
	{/each}
</nav>

{#if data.category && !data.decided && data.canModerate && data.markets.length}
	<form method="POST" action="?/setHeadliner" use:enhance class="mb-5 flex flex-wrap items-end gap-2 text-sm">
		<label>Headliner
			<select class="min-h-11 max-w-full" name="marketId">
				{#each data.markets as m (m.id)}<option value={m.id} selected={m.id === data.headlinerId}>{m.question}</option>{/each}
			</select>
		</label>
		<button class="quiet">Set headliner</button>
		{#if form?.error}<span role="alert">{form.error}</span>{/if}
	</form>
{/if}

{#if data.markets.length === 0}
	<p class={meta}>{data.decided ? 'No decided markets yet.' : 'No open markets yet.'}</p>
{:else}
	{#each groups as g (g.name)}
		{#if !data.category && data.categories.length}<h2 class="mt-6 mb-0 text-lg">{g.name}</h2>{/if}
		<ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4 p-0">
		{#each entriesOf(g.list) as entry (entry[0].id)}
			{#if entry[0].questionGroupId !== null}
				<!-- A banner picture puts the title straight above the close time, so the two sit closer. -->
				<li class="{card} [&>h2+p]:-mt-2.5" style:border-top={entry[0].colorPrimary ? `4px solid ${entry[0].colorPrimary}` : undefined}>
					<MarketHeading src={questionPicture(entry)}>
						<h2 class={title}><a href="/questions/{entry[0].questionGroupId}">{entry[0].question}</a></h2>
					</MarketHeading>
					{#if data.decided}
						<p class={meta}>{winnerText(entry)}{entry[0].resolvedAt ? `, ${closes(entry[0].resolvedAt)}` : ''}</p>
					{:else}
						<p class={meta}>{closes(entry[0].closeAt)}</p>
					{/if}
					<p class={head} aria-hidden="true"><span>Option</span><span>Chance</span></p>
					{#each entry as o (o.id)}
						<!-- One row per option, name and chance on the left, Yes and No on the right (like the Polymarket date market). -->
						<div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t border-border pt-2.5">
							<a class="text-sm font-strong text-fg no-underline" href="/markets/{o.id}">{o.optionLabel}</a>
							<span class={pill} aria-label="{pct(yesOf(o))}% chance">{pct(yesOf(o))}%</span>
							{#if data.decided}
								<span class={meta}>{o.status === 'cancelled' ? 'Cancelled' : o.winner === 'Yes' ? 'Won' : 'Lost'}</span>
							{:else}
								<a class="{choice} text-yes-text" href="/markets/{o.id}">Yes {pct(yesOf(o))}%</a>
								<a class="{choice} text-no-text" href="/markets/{o.id}">No {pct(1 - yesOf(o))}%</a>
							{/if}
						</div>
					{/each}
				</li>
			{:else}
				{@const m = entry[0]}
				<li class={[card, '[&>h2+p]:-mt-2.5', m.id === data.headlinerId && 'col-span-full']} style:border-top={m.colorPrimary ? `4px solid ${m.colorPrimary}` : undefined}>
					{#if m.id === data.headlinerId}<p class="m-0 text-xs font-strong tracking-[0.04em] text-muted uppercase">Headliner</p>{/if}
					<MarketHeading large={m.id === data.headlinerId} src={m.imageFile ? `/market-images/${m.imageFile}` : null}>
						<h2 class={title}><a href="/markets/{m.id}">{m.question}</a></h2>
					</MarketHeading>
					{#if data.decided}
						<p class={meta}>{m.status === 'cancelled' ? 'Cancelled' : `Won by ${m.winner ?? '?'}`}{m.resolvedAt ? `, ${closes(m.resolvedAt)}` : ''}</p>
					{:else}
						<p class={meta}>{closes(m.closeAt)}</p>
					{/if}
					<p class={head} aria-hidden="true"><span>Outcome</span><span>Chance</span></p>
					{#each topOf(m.outcomes) as o (o.label)}
						<div class="flex items-center justify-between gap-3">
							<span class="grid flex-1 gap-1">
								{o.label}
								<!-- Bar length is the probability. -->
								<span class="h-0.5 max-w-full rounded-full {sideBar[side(o.label)] ?? 'bg-fg-2'}" style:width="{pct(o.probability)}%"></span>
							</span>
							<span class="{pill} {sideText[side(o.label)] ?? ''}" aria-label="{pct(o.probability)}% chance">{pct(o.probability)}%</span>
						</div>
					{/each}
					{#if m.outcomes.length > 2}
						<p class={meta}>{m.outcomes.length} outcomes</p>
					{/if}
				</li>
			{/if}
		{/each}
		</ul>
	{/each}
{/if}
