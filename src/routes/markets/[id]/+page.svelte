<script lang="ts">
	import { coins, dateTime } from '#lib/format.ts';
	import MarketHeading from '#lib/MarketHeading.svelte';
	import { onMount } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { ActionData, PageProps } from './$types';
	import { floorCoins, floorShares, proceedsForSell, sharesForSpend } from '../../../engine/lmsr.ts';
	import { linkify } from '../../../lib/linkify.ts';
	import { netOfFee, sellFee, SELL_FEE } from '../../../engine/fees.ts';

	let { data, form }: PageProps = $props();
	// Live prices (vault "Live prices"): the page starts from the server's data, then follows the stream for this market.
	// The effect below keeps these in step with the server's data; the first value is the loaded page.
	// svelte-ignore state_referenced_locally
	let live = $state(structuredClone(data.outcomes));
	// svelte-ignore state_referenced_locally
	let series = $state(structuredClone(data.series));
	let connected = $state(false);
	// The picture is as tall as the header text, so it never adds height above the graph.
	let headH = $state(0);
	$effect(() => {
		live = structuredClone(data.outcomes);
		series = structuredClone(data.series);
	});
	type Live = { marketId: number; status: string; locked: boolean; outcomes: { id: number; q: number; probability: number }[] };
	// Prices moved: update the trade maths and add a point to each line. A status or lock change reloads the page's data instead.
	const apply = (s: Live) => {
		if (s.status !== data.market.status || s.locked !== data.market.locked) return void invalidateAll();
		const at = Date.now();
		s.outcomes.forEach((o, i) => {
			const cur = live[i];
			if (!cur || cur.id !== o.id) return;
			if (cur.probability !== o.probability) series[i].points.push({ t: at, p: o.probability });
			live[i] = { ...cur, q: o.q, probability: o.probability };
		});
	};
	// The stream is open only while the tab is visible: a hidden tab costs the server nothing (vault "Live prices").
	onMount(() => {
		let es: EventSource | null = null;
		const open = () => {
			if (es) return;
			es = new EventSource(`/live/market/${data.market.id}`);
			es.addEventListener('snapshot', (e) => {
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
	const act = $derived(form as ActionData | undefined);

	const pct = (p: number) => `${Math.round(p * 100)}%`;
	const when = dateTime;
	// The headline chance: Yes on a yes/no market, otherwise whichever outcome leads.
	const lead = $derived(live.find((o) => live.length === 2 && side(o.label) === 'yes') ?? live.reduce((a, b) => (b.probability > a.probability ? b : a), live[0]));
	const side = (label: string) => ({ yes: 'yes', no: 'no' })[label.trim().toLowerCase()] ?? '';
	// Yes/No always use the house colours, as on the market list. Otherwise the outcome's own colour, then the market's primary and secondary, then a palette.
	const palette = ['#4f7cff', '#f5a524', '#14b8a6', '#e11d48', '#8b5cf6', '#84cc16', '#06b6d4', '#f97316', '#64748b', '#d946ef'];
	type Shown = { label: string; color: string | null; imageFile: string | null; avatar: string | null };
	const colour = (o: Shown, i: number) =>
		({ yes: 'var(--yes)', no: 'var(--no)' })[side(o.label)] ??
		o.color ??
		(i === 0 && data.market.colorPrimary ? data.market.colorPrimary : i === 1 && data.market.colorSecondary ? data.market.colorSecondary : palette[i % palette.length]);
	const price = (p: number) => `${p.toFixed(2)} ${data.market.currency}`;

	// Hover on the chart: the chance of every outcome at that moment, as the line steps through the trades (Polymarket-style).
	let hoverT = $state<number | null>(null);
	const onHover = (e: PointerEvent) => {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		hoverT = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0);
	};
	const probAt = (i: number) => {
		if (hoverT === null) return live[i].probability;
		let p = series[i].points[0].p;
		for (const pt of series[i].points) if (pt.t <= hoverT) p = pt.p;
		return p;
	};

	// Trade panel. The quote is the same LMSR maths the server runs; the server still enforces the slippage limit.
	let mode = $state<'buy' | 'sell'>('buy');
	// A question's Yes or No button opens here with that side already picked (`?side=no#trade`).
	// svelte-ignore state_referenced_locally
	let picked = $state<number | null>(data.outcomes.find((o) => o.label.trim().toLowerCase() === page.url.searchParams.get('side'))?.id ?? null);
	const outcomeId = $derived(picked ?? live[0]?.id ?? 0);
	let spend = $state<number>(10);
	let sellShares = $state<number>(0);
	// One idempotency key per submitted trade, so a double tap can't pay twice (ADR-006).
	let key = $state(crypto.randomUUID());
	const fresh: SubmitFunction = () => async ({ update }) => {
		await update({ reset: false });
		key = crypto.randomUUID();
	};

	const idx = $derived(live.findIndex((o) => o.id === outcomeId));
	const selected = $derived(live[idx]);
	const qs = $derived(live.map((o) => o.q));
	const spendOk = $derived(Number.isSafeInteger(spend) && spend > 0);
	const buyShares = $derived(idx >= 0 && spendOk ? floorShares(sharesForSpend(qs, data.market.b, idx, spend)) : 0);
	const buyMin = $derived(floorShares(buyShares * 0.98));
	// Average price per share in the market's currency, and what a winning share pays (1 dabloon each, rounded down).
	const avgPrice = $derived(buyShares > 0 ? spend / buyShares : 0);
	const held = $derived(data.positions.find((p) => p.outcomeId === outcomeId)?.shares ?? 0);
	const sellOk = $derived(Number.isSafeInteger(sellShares) && sellShares > 0 && sellShares <= held);
	// Every sale pays the early-sale fee (ADR-021): gross is the LMSR value, proceeds is what the member keeps.
	const feePct = Math.round(SELL_FEE * 100);
	const gross = $derived(idx >= 0 && sellOk ? floorCoins(proceedsForSell(qs, data.market.b, idx, floorShares(sellShares))) : 0);
	const proceeds = $derived(netOfFee(gross));
	const feeCoins = $derived(sellFee(gross));
	const sellMin = $derived(floorCoins(proceeds * 0.98));
	const allProceeds = $derived(idx >= 0 && held > 0 ? netOfFee(floorCoins(proceedsForSell(qs, data.market.b, idx, floorShares(held)))) : 0);

	// Chart: one line per outcome, time on x, probability on y. Each line runs to "now" (or to the close time).
	const W = 600;
	const H = 200;
	const t0 = $derived(Math.min(...series.map((s) => s.points[0].t)));
	const t1 = $derived(data.market.chartEnd ? new Date(data.market.chartEnd).getTime() : Math.max(Date.now(), ...series.flatMap((s) => s.points.map((p) => p.t))));
	const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
	const hoverX = $derived(hoverT === null ? null : x(hoverT));
	const hoverWhen = $derived(hoverT === null ? '' : when(new Date(hoverT)));
	const y = (p: number) => H - p * H;
	const paths = $derived(
		series.map((s) => {
			const last = s.points[s.points.length - 1];
			const pts = [...s.points, { t: t1, p: last.p }];
			return pts.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(' ');
		}),
	);

	const statusText = $derived(
		({
			pending_review: 'Waiting for a moderator to approve this market. Trading opens once it is approved.',
			open: data.market.closeAt ? `Trading open until ${when(data.market.closeAt)}.` : 'Trading open. No set close date.',
			closed: 'Trading has closed. Waiting for a moderator to resolve it.',
			resolved: 'Resolved. The dispute window is open.',
			final: 'Final.',
			cancelled: `Cancelled. Everyone got back what they paid in.${data.market.cancelReason ? ` Reason: ${data.market.cancelReason}` : ''}`,
			rejected: 'A moderator did not approve this market.',
		})[data.market.status] ?? '',
	);
	const canComment = $derived(!['pending_review', 'rejected'].includes(data.market.status));
	// Only moderators, admins and members granted this market can propose a result (vault "Resolution and payouts").
	const canPropose = $derived(data.canResolve && (data.market.status === 'open' || data.market.status === 'closed'));
		// Moderators and admins see the Resolution section only after they open it.
		let resolving = $state(false);

	// Shared classes. Buttons and inputs take the page's font (browsers give them their own); "go" is also the offline-pause hook.
	const card = 'grid content-start gap-3 rounded-card bg-card p-4 shadow-card';
	// Phone: every card but the chart comes after the trade panel.
	const rest = 'max-[899px]:order-2';
	const h2 = 'm-0 text-base font-strong';
	const meta = 'm-0 text-sm text-muted';
	const notice = 'm-0 rounded-xl bg-card-2 p-3';
	const error = 'm-0 text-no-text';
	const ok = 'm-0 text-yes-text';
	const pill = 'min-h-11 cursor-pointer rounded-pill border-0 [font-family:inherit] [font-size:inherit] [font-weight:inherit]';
	const go = 'go min-h-11 cursor-pointer rounded-pill border-0 bg-fg font-strong text-bg [font-family:inherit] [font-size:inherit] disabled:cursor-default disabled:opacity-40';
	const field = 'grid gap-1.5 text-sm font-strong';
	const input = 'min-h-11 rounded-xl border border-border bg-card px-3 py-2 font-body text-fg [font-family:inherit] [font-size:inherit]';
	const plain = 'm-0 grid list-none gap-2.5 p-0';
	const pic = 'size-5 rounded object-cover';
	const swatch = 'mr-1.5 inline-block size-2.5 rounded-full';
</script>

<svelte:head><title>{data.market.question} · Monoglarket</title></svelte:head>

<!-- A square picture sits out of the flow: its side is the header's height, so the header does not grow. Phones: it flows under the heading. -->
<header class={['relative mb-4 [&_a]:text-inherit min-[601px]:[&_.logo]:absolute min-[601px]:[&_.logo]:top-0 min-[601px]:[&_.logo]:right-0 min-[601px]:[&_.logo]:size-(--pic) min-[601px]:[&_.logo]:rounded-xl', data.market.imageFile && 'min-[601px]:pr-(--pic)']} bind:clientHeight={headH} style:--pic="{headH}px">
	<p class={meta}>{data.market.creator ? `Proposed by ${data.market.creator}` : ''} · {data.market.currency}</p>
	{#if data.market.questionGroupId}<p class={meta}>Option of <a href="/questions/{data.market.questionGroupId}">a several-winner question</a>{data.market.optionLabel ? `: ${data.market.optionLabel}` : ''}</p>{/if}
	<MarketHeading large src={data.market.imageFile ? `/market-images/${data.market.imageFile}` : null}>
		<!-- Questions run long: smaller than a page title on phones. -->
		<h1 class="mt-1 mb-2 text-[clamp(1.5rem,5vw,2.25rem)]">{data.market.question}</h1>
	</MarketHeading>
	{#if lead && !data.market.resolvedOutcomeId}
		<p class="mt-0 mb-2 text-fg-2"><strong class={['font-display text-5xl leading-none font-[650] tabular-nums [font-stretch:var(--stretch-display)]', side(lead.label) === 'yes' ? 'text-yes-text' : 'text-fg']}>{pct(lead.probability)}</strong> {side(lead.label) === 'yes' ? 'chance of Yes' : live.filter((o) => o.probability === lead.probability).length > 1 ? 'each, tied for the lead' : `${lead.label} leads`}</p>
	{/if}
	<p class="m-0 text-sm text-fg-2">{statusText} {#if connected}<span class="text-[0.8125rem] font-strong text-yes-text">● Live</span>{/if}</p>
	{#if data.market.deleted}<p class={notice} role="status">Deleted. Only admins can see this market.</p>{/if}
	{#if data.market.visibility !== 'public' && data.canModerate}<p class={meta}>Visibility: {data.market.visibility === 'hidden' ? 'hidden from members' : 'limited to a group'}</p>{/if}
	{#if data.canModerate}<p class={meta}><a href="/markets/{data.market.id}/edit">Edit options and settings</a> · <a href="/markets/{data.market.id}/appearance">Edit the look</a></p>{/if}
	<p class={meta}>{data.market.resolution ? `Resolves automatically from ${data.market.resolution}, then a moderator confirms.` : 'Resolved by moderators.'}</p>
	{#if data.canModerate}<p class={meta}><a href="/moderate">Open the moderation queue →</a></p>{/if}
</header>

<!-- Phone: the chart, then trading, then the rest (the column's cards join the page grid). Desktop: trading sticks to the right of the chart. -->
<div class="grid gap-4 [&_a]:text-inherit min-[900px]:grid-cols-[minmax(0,1fr)_360px] min-[900px]:items-start">
	<!-- Many outcomes: on desktop the panel scrolls itself so Buy stays reachable. -->
	<section class="{card} order-1 min-[900px]:sticky min-[900px]:top-4 min-[900px]:col-start-2 min-[900px]:row-start-1 min-[900px]:max-h-[calc(100vh-32px)] min-[900px]:overflow-y-auto" id="trade" aria-label="Trade">
		{#if data.market.onBreak}
			<p class={notice} role="status">You're on a break from trading until {when(data.market.onBreak)}. You can still look around, and payouts still arrive.</p>
		{:else if data.market.locked}
			<p class={notice} role="status">Trading is paused while this is happening. A moderator will reopen it.</p>
		{:else if data.market.tradable}
			<div class="grid grid-cols-2 rounded-pill bg-card-2 p-1" role="tablist">
				<button type="button" role="tab" aria-selected={mode === 'buy'} class={[pill, 'text-fg', mode === 'buy' ? 'bg-card font-strong' : 'bg-card-2']} onclick={() => (mode = 'buy')}>Buy</button>
				<button type="button" role="tab" aria-selected={mode === 'sell'} class={[pill, 'text-fg', mode === 'sell' ? 'bg-card font-strong' : 'bg-card-2']} onclick={() => (mode = 'sell')}>Sell</button>
			</div>

			<!-- Two outcomes sit side by side; a multiple-choice market (up to 10) wraps into columns. -->
			<div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-2" role="radiogroup" aria-label="Outcome">
				{#each live as o, i (o.id)}
					<button type="button" role="radio" aria-checked={o.id === outcomeId} class={[pill, 'flex items-center justify-between border-2 bg-card-2 px-3 text-fg', o.id === outcomeId ? 'border-fg-2' : 'border-transparent']} onclick={() => (picked = o.id)}>
						{#if o.imageFile}<img class={pic} src="/market-images/{o.imageFile}" alt="" />{:else if o.avatar}<img class={pic} src={o.avatar} alt="" />{:else}<span class={swatch} style:background={colour(o, i)}></span>{/if}
						<span>{o.label}</span>
						<span class="font-strong tabular-nums">{price(o.probability)}</span>
					</button>
				{/each}
			</div>

			{#if mode === 'buy'}
				<div class="grid grid-cols-4 gap-2" role="group" aria-label="Amount">
					{#each [10, 25, 50, 100] as amt (amt)}
						<button type="button" class={[pill, spend === amt ? 'bg-fg text-bg' : 'bg-card-2 text-fg']} onclick={() => (spend = amt)}>{amt}</button>
					{/each}
				</div>
				<form class="grid gap-3" method="POST" action="?/buy" use:enhance={fresh}>
					<input type="hidden" name="outcomeId" value={outcomeId} />
					<input type="hidden" name="key" value={key} />
					<input type="hidden" name="minShares" value={buyMin} />
					<label class={field}>
						Spend ({data.market.currency})
						<input class={input} name="spend" type="number" inputmode="numeric" min="1" step="1" bind:value={spend} />
					</label>
					<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
						<dt class="text-muted">Avg. price</dt><dd class="m-0 text-right font-strong">{buyShares > 0 ? `${avgPrice.toFixed(2)} ${data.market.currency}` : '—'}</dd>
						<dt class="text-muted">To win</dt><dd class="m-0 text-right font-strong">{buyShares > 0 ? `${coins(floorCoins(buyShares))} ${data.market.currency}` : '—'}</dd>
					</dl>
					<p class={meta}>{buyShares > 0 ? `About ${buyShares.toFixed(2)} shares. Fills only if you get at least ${buyMin.toFixed(2)}.` : 'Enter an amount to see the quote.'}</p>
					<button class={go} disabled={!spendOk || buyShares <= 0 || spend > data.balance}>Buy “{selected?.label}”</button>
				</form>
			{:else}
				<form class="grid gap-3" method="POST" action="?/sell" use:enhance={fresh}>
					<input type="hidden" name="outcomeId" value={outcomeId} />
					<input type="hidden" name="key" value={key} />
					<input type="hidden" name="minProceeds" value={sellMin} />
					<label class={field}>
						Shares to sell (you hold {held.toFixed(2)})
						<input class={input} name="shares" type="number" inputmode="decimal" min="0.000001" step="any" max={held} bind:value={sellShares} />
					</label>
					<button type="button" class="{pill} bg-card-2 text-fg" disabled={held <= 0} onclick={() => (sellShares = held)}>Sell all</button>
					<p class="m-0 text-sm">
						{#if proceeds > 0}
							Sale value {coins(gross)} {data.market.currency}, less the {feePct}% early-sale fee of {coins(feeCoins)}. You receive about {coins(proceeds)} {data.market.currency}. Fills only if you get at least {coins(sellMin)}.
						{:else}
							{held > 0 ? 'Enter how many shares to sell.' : `You don’t hold “${selected?.label}”.`}
						{/if}
					</p>
					<button class={go} disabled={!sellOk || proceeds <= 0}>Sell “{selected?.label}”</button>
				</form>
				{#if held > 0}
					<form class="grid gap-3" method="POST" action="?/sell" use:enhance={fresh}>
						<input type="hidden" name="outcomeId" value={outcomeId} />
						<input type="hidden" name="key" value={key} />
						<input type="hidden" name="shares" value="all" />
						<input type="hidden" name="minProceeds" value={floorCoins(allProceeds * 0.98)} />
						<p class="m-0 text-sm">Cash out all {held.toFixed(2)} shares: about {coins(allProceeds)} {data.market.currency} after the {feePct}% fee. Fills only if you get at least {coins(floorCoins(allProceeds * 0.98))}.</p>
						<button class={go} disabled={allProceeds <= 0}>Cash out “{selected?.label}”</button>
					</form>
				{/if}
			{/if}

			{#if form?.tradeError}<p class={error} role="alert">{form.tradeError}</p>{/if}
			{#if act && 'traded' in act}<p class={ok} role="status">Done. Your balance is updated.</p>{/if}
			<p class={meta}>Balance: {coins(data.balance)} {data.market.currency} · Spend limit here: {data.market.spendCap == null ? 'none' : coins(data.market.spendCap)}</p>
		{:else}
			<p class={meta}>{data.market.status === 'open' || data.market.status === 'closed' ? 'Trading is closed.' : 'Trading is not open for this market.'}</p>
		{/if}
	</section>

	<div class="grid content-start gap-4 max-[899px]:contents">
		<section class={card}>
			<h2 class={h2}>Chance over time</h2>
			<div class="relative">
			<svg class="block h-[200px] w-full cursor-crosshair touch-pan-y" viewBox="0 0 {W} {H}" role="img" aria-label="Chance of each outcome over time" preserveAspectRatio="none" onpointermove={onHover} onpointerdown={onHover} onpointerleave={() => (hoverT = null)}>
				{#each [0.25, 0.5, 0.75] as g (g)}
					<line x1="0" x2={W} y1={y(g)} y2={y(g)} class="stroke-border [stroke-dasharray:4_4]" />
				{/each}
				{#each paths as d, i (i)}
					<path {d} fill="none" stroke={colour(live[i], i)} stroke-width={i === idx ? 3.5 : 2} vector-effect="non-scaling-stroke" />
				{/each}
				{#if hoverX !== null}
					<line x1={hoverX} x2={hoverX} y1="0" y2={H} class="stroke-fg-2 stroke-1" />
					{#each live as o, i (o.id)}
						<circle cx={hoverX} cy={y(probAt(i))} r="4" fill={colour(o, i)} />
					{/each}
				{/if}
			</svg>
				{#if hoverX !== null}
					<!-- Floats over the chart at the hovered moment: the time and every outcome's chance then. -->
					<div class={['pointer-events-none absolute top-2 min-w-[180px] rounded-xl border border-border bg-card px-3 py-2 text-[0.8125rem] shadow-card', hoverX / W > 0.6 ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3']} style:left="{(hoverX / W) * 100}%">
						<p class="mt-0 mb-1 text-muted">{hoverWhen}</p>
						<ul class="m-0 grid list-none gap-1 p-0">
							{#each live as o, i (o.id)}
								<li class="flex items-center gap-1.5"><span class={swatch} style:background={colour(o, i)}></span>{o.label}<strong class="ml-auto pl-3 tabular-nums">{pct(probAt(i))}</strong></li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
			<p class="{meta} min-h-[1.5em]" aria-live="polite">{hoverT === null ? 'Move across the chart to see the chance at any time.' : hoverWhen}</p>
			<ul class="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-sm">
				{#each live as o, i (o.id)}
					<li>
						<button type="button" class={['inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pill border-0 bg-card-2 px-2.5 text-fg [font:inherit]', o.id === outcomeId && 'outline-2 outline-fg']} onclick={() => (picked = o.id)}>
							{#if o.imageFile}<img class={pic} src="/market-images/{o.imageFile}" alt="" />{:else if o.avatar}<img class={pic} src={o.avatar} alt="" />{:else}<span class={swatch} style:background={colour(o, i)}></span>{/if}
							{o.label} <span class="font-strong tabular-nums">{price(probAt(i))}</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<section class="{card} {rest}">
			<h2 class={h2}>Resolution</h2>
				{#if data.canModerate && !resolving}
					<button class={go} onclick={() => (resolving = true)}>Resolve market</button>
				{:else}
			<p>{data.market.criteria}</p>
			{#if data.market.disputeOpen}
				<p class={notice} role="status">Dispute window open until {when(data.market.disputeUntil!)}. Anyone can dispute this result under Report a problem, and a moderator can change it until then.</p>
			{/if}
			{#if data.market.resolvedOutcomeId}
				<p><strong>Winner:</strong> {live.find((o) => o.id === data.market.resolvedOutcomeId)?.label}</p>
			{/if}
			{#each data.proposals as p (p.id)}
				<div class="[&_p]:mt-0 [&_p]:mb-1">
					<p><strong>{p.outcome}</strong> {p.status === 'pending' ? 'proposed' : 'accepted'} by {p.proposer}, {when(p.createdAt)}</p>
					<p class="wrap-anywhere">{#each linkify(p.evidence) as part}{#if part.href}<a href={part.href} rel="noopener noreferrer nofollow" target="_blank">{part.text}</a>{:else}{part.text}{/if}{/each}</p>
					{#if p.proofs.length}
						<ul class="grid list-none gap-2 p-0">
							{#each p.proofs as pf (pf.id)}
								<li>
									{#if pf.kind === 'link'}<a href={pf.url} rel="noopener noreferrer nofollow" target="_blank">{pf.label}</a>
									{:else if pf.kind === 'image'}<a href="/proofs/{pf.id}" target="_blank"><img class="block max-h-[180px] max-w-full rounded-lg" src="/proofs/{pf.id}" alt={pf.label} loading="lazy" /></a> <span class={meta}>{pf.label}</span>
									{:else}<a href="/proofs/{pf.id}" target="_blank" rel="noopener">{pf.label}</a>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if p.status === 'pending'}<p class={meta}>Waiting for a moderator.</p>{/if}
				</div>
			{/each}
			{#if canPropose && data.market.onBreak}
				<p class={meta}>You can't request a resolution while on a break.</p>
			{:else if canPropose}
				<form method="POST" action="?/propose" class="grid gap-3" enctype="multipart/form-data" use:enhance>
					<fieldset class="m-0 grid gap-1.5 border-0 p-0">
						<legend class="mb-1.5 p-0 text-sm font-strong">Propose the result</legend>
						{#each live as o, i (o.id)}
							<label class="flex min-h-11 items-center gap-2"><input type="radio" name="outcomeId" value={o.id} checked={i === 0} /> {o.label}</label>
						{/each}
					</fieldset>
					<label class={field}>
						Description: explain the evidence. Links in it are clickable, and everyone can read it.
						<textarea class={input} name="evidence" rows="2" required maxlength="500"></textarea>
					</label>
					<label class={field}>
						Proof: pictures or PDFs, up to 5 pieces in all, 5 MB each
						<input type="file" name="proofFile" multiple accept="image/png,image/jpeg,image/webp,application/pdf" />
					</label>
					<label class={field}>
						Proof links, one per line (https only). Add a caption after a bar: https://example.com | Final score
						<textarea class={input} name="proofLinks" rows="2"></textarea>
					</label>
					<button class={go}>Propose result</button>
					{#if form?.proposeError}<p class={error} role="alert">{form.proposeError}</p>{/if}
					{#if act && 'proposed' in act}<p class={ok} role="status">Sent. A moderator will look at it.</p>{/if}
				</form>
			{/if}
			<details class="mt-3">
				<summary class="flex min-h-11 cursor-pointer items-center text-sm text-fg-2">Report a problem</summary>
				<form class="grid gap-3" method="POST" action="?/report" use:enhance>
					<label class={field}>
						What is wrong?
						<select name="kind">
							<option value="market">The market: its wording, criteria or close time</option>
							{#if data.market.disputeOpen}
								<option value="resolution">The result (dispute)</option>
							{/if}
						</select>
					</label>
					<label class={field}>
						Tell the moderators what is wrong. Only moderators and admins read this.
						<textarea class={input} name="body" rows="3" required minlength="5" maxlength="1000"></textarea>
					</label>
					<button class="quiet">Send report</button>
					{#if form?.reportError}<p class={error} role="alert">{form.reportError}</p>{/if}
					{#if act && 'reported' in act}<p class={ok} role="status">Sent. A moderator will look at it.</p>{/if}
				</form>
			</details>
				{/if}
		</section>

		{#if data.positions.some((p) => p.shares > 0)}
			<section class="{card} {rest}">
				<h2 class={h2}>Your position</h2>
				<ul class={plain}>
					{#each data.positions.filter((p) => p.shares > 0) as p (p.outcomeId)}
						<li>{live.find((o) => o.id === p.outcomeId)?.label}: {p.shares.toFixed(2)} shares, {coins(p.netSpent)} {data.market.currency} in</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="{card} {rest}">
			<h2 class={h2}>Trades</h2>
			{#if data.feed.length === 0}
				<p class={meta}>No trades yet.</p>
			{:else}
				<ul class={plain}>
					{#each data.feed as t (t.id)}
						<li class="grid gap-0.5 border-b border-border pb-2.5 text-sm">
							<span><a href="/users/{t.whoId}">{t.who}</a> {t.shares > 0 ? 'bought' : 'sold'} {Math.abs(t.shares).toFixed(2)} “{t.outcome}” for {coins(t.amount)} {data.market.currency}</span>
							<span class={meta}>{pct(t.probAfter)} · {when(t.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="{card} {rest}" aria-labelledby="comments-title">
			<h2 class={h2} id="comments-title">Comments</h2>
			{#if canComment}
				<form method="POST" action="?/comment" use:enhance class="mb-3 grid gap-2">
					<label class={field}>
						<span class="sr-only">Your comment</span>
						<textarea class={input} name="body" rows="2" required maxlength="500" placeholder="Say why you think so. Be kind; keep it about the market."></textarea>
					</label>
					<button class="quiet">Post comment</button>
					{#if form?.commentError}<p class={error} role="alert">{form.commentError}</p>{/if}
				</form>
			{:else}
				<p class={meta}>Comments open once the market is approved.</p>
			{/if}
			{#if data.comments.length === 0}
				<p class={meta}>No comments yet.</p>
			{:else}
				<ul class="m-0 grid list-none gap-3 p-0">
					{#each data.comments as c (c.id)}
						<li class="border-t border-border pt-2.5">
							<p class="m-0 text-sm font-strong"><a href="/users/{c.whoId}">{c.who}</a> <span class={meta}>{when(c.createdAt)}{c.hidden ? ' · hidden by a moderator' : ''}</span></p>
							<p class={['m-0', c.hidden && 'text-muted italic']}>{c.body}</p>
							{#if data.canModerate && !c.hidden}
								<form class="grid gap-3" method="POST" action="?/hide" use:enhance>
									<input type="hidden" name="commentId" value={c.id} />
									<button class="quiet min-h-9 px-3 text-[0.8125rem]">Hide</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
