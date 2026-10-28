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
	const side = (label: string) => ({ yes: 'yes', no: 'no' })[label.trim().toLowerCase()] ?? '';
	// An outcome's own colour wins. Otherwise Yes/No keep the house colours, then the market's primary and secondary, then a palette.
	const palette = ['#4f7cff', '#f5a524', '#14b8a6', '#e11d48', '#8b5cf6', '#84cc16', '#06b6d4', '#f97316', '#64748b', '#d946ef'];
	type Shown = { label: string; color: string | null; imageFile: string | null; avatar: string | null };
	const colour = (o: Shown, i: number) =>
		o.color ??
		({ yes: 'var(--yes)', no: 'var(--no)' })[side(o.label)] ??
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
</script>

<svelte:head><title>{data.market.question} · MonoGlarket</title></svelte:head>

<header class="head" class:framed={!!data.market.imageFile} bind:clientHeight={headH} style:--pic="{headH}px">
	<p class="meta">{data.market.creator ? `Proposed by ${data.market.creator}` : ''} · {data.market.currency}</p>
	{#if data.market.questionGroupId}<p class="meta">Option of <a href="/questions/{data.market.questionGroupId}">a several-winner question</a>{data.market.optionLabel ? `: ${data.market.optionLabel}` : ''}</p>{/if}
	<MarketHeading large src={data.market.imageFile ? `/market-images/${data.market.imageFile}` : null}>
		<h1>{data.market.question}</h1>
	</MarketHeading>
	<p class="status">{statusText} {#if connected}<span class="live">● Live</span>{/if}</p>
	{#if data.market.deleted}<p class="notice" role="status">Deleted. Only admins can see this market.</p>{/if}
	{#if data.market.visibility !== 'public' && data.canModerate}<p class="meta">Visibility: {data.market.visibility === 'hidden' ? 'hidden from members' : 'limited to a group'}</p>{/if}
	{#if data.canModerate}<p class="meta"><a href="/markets/{data.market.id}/edit">Edit options and settings</a> · <a href="/markets/{data.market.id}/appearance">Edit the look</a></p>{/if}
	<p class="meta">{data.market.resolution ? `Resolves automatically from ${data.market.resolution}, then a moderator confirms.` : 'Resolved by moderators.'}</p>
	{#if data.canModerate}<p class="meta"><a href="/moderate">Open the moderation queue →</a></p>{/if}
</header>

<div class="layout">
	<section class="trade card" id="trade" aria-label="Trade">
		{#if data.market.onBreak}
			<p class="notice" role="status">You're on a break from trading until {when(data.market.onBreak)}. You can still look around, and payouts still arrive.</p>
		{:else if data.market.locked}
			<p class="notice" role="status">Trading is paused while this is happening. A moderator will reopen it.</p>
		{:else if data.market.tradable}
			<div class="seg" role="tablist">
				<button type="button" role="tab" aria-selected={mode === 'buy'} class:on={mode === 'buy'} onclick={() => (mode = 'buy')}>Buy</button>
				<button type="button" role="tab" aria-selected={mode === 'sell'} class:on={mode === 'sell'} onclick={() => (mode = 'sell')}>Sell</button>
			</div>

			<div class="outcomes-pick" role="radiogroup" aria-label="Outcome">
				{#each live as o, i (o.id)}
					<button type="button" role="radio" aria-checked={o.id === outcomeId} class="pick {side(o.label)}" class:on={o.id === outcomeId} onclick={() => (picked = o.id)}>
						{#if o.imageFile}<img class="pick-pic" src="/market-images/{o.imageFile}" alt="" />{:else if o.avatar}<img class="pick-pic" src={o.avatar} alt="" />{:else}<span class="swatch" style:background={colour(o, i)}></span>{/if}
						<span>{o.label}</span>
						<span class="pct">{price(o.probability)}</span>
					</button>
				{/each}
			</div>

			{#if mode === 'buy'}
				<div class="chips" role="group" aria-label="Amount">
					{#each [10, 25, 50, 100] as amt (amt)}
						<button type="button" class="chip" class:on={spend === amt} onclick={() => (spend = amt)}>{amt}</button>
					{/each}
				</div>
				<form method="POST" action="?/buy" use:enhance={fresh}>
					<input type="hidden" name="outcomeId" value={outcomeId} />
					<input type="hidden" name="key" value={key} />
					<input type="hidden" name="minShares" value={buyMin} />
					<label class="field">
						Spend ({data.market.currency})
						<input name="spend" type="number" inputmode="numeric" min="1" step="1" bind:value={spend} />
					</label>
					<dl class="quote">
						<dt>Avg. price</dt><dd>{buyShares > 0 ? `${avgPrice.toFixed(2)} ${data.market.currency}` : '—'}</dd>
						<dt>To win</dt><dd>{buyShares > 0 ? `${coins(floorCoins(buyShares))} ${data.market.currency}` : '—'}</dd>
					</dl>
					<p class="meta">{buyShares > 0 ? `About ${buyShares.toFixed(2)} shares. Fills only if you get at least ${buyMin.toFixed(2)}.` : 'Enter an amount to see the quote.'}</p>
					<button class="go" disabled={!spendOk || buyShares <= 0 || spend > data.balance}>Buy “{selected?.label}”</button>
				</form>
			{:else}
				<form method="POST" action="?/sell" use:enhance={fresh}>
					<input type="hidden" name="outcomeId" value={outcomeId} />
					<input type="hidden" name="key" value={key} />
					<input type="hidden" name="minProceeds" value={sellMin} />
					<label class="field">
						Shares to sell (you hold {held.toFixed(2)})
						<input name="shares" type="number" inputmode="decimal" min="0.000001" step="any" max={held} bind:value={sellShares} />
					</label>
					<button type="button" class="chip" disabled={held <= 0} onclick={() => (sellShares = held)}>Sell all</button>
					<p class="quote">
						{#if proceeds > 0}
							Sale value {coins(gross)} {data.market.currency}, less the {feePct}% early-sale fee of {coins(feeCoins)}. You receive about {coins(proceeds)} {data.market.currency}. Fills only if you get at least {coins(sellMin)}.
						{:else}
							{held > 0 ? 'Enter how many shares to sell.' : `You don’t hold “${selected?.label}”.`}
						{/if}
					</p>
					<button class="go" disabled={!sellOk || proceeds <= 0}>Sell “{selected?.label}”</button>
				</form>
				{#if held > 0}
					<form method="POST" action="?/sell" use:enhance={fresh}>
						<input type="hidden" name="outcomeId" value={outcomeId} />
						<input type="hidden" name="key" value={key} />
						<input type="hidden" name="shares" value="all" />
						<input type="hidden" name="minProceeds" value={floorCoins(allProceeds * 0.98)} />
						<p class="quote">Cash out all {held.toFixed(2)} shares: about {coins(allProceeds)} {data.market.currency} after the {feePct}% fee. Fills only if you get at least {coins(floorCoins(allProceeds * 0.98))}.</p>
						<button class="go" disabled={allProceeds <= 0}>Cash out “{selected?.label}”</button>
					</form>
				{/if}
			{/if}

			{#if form?.tradeError}<p class="error" role="alert">{form.tradeError}</p>{/if}
			{#if act && 'traded' in act}<p class="ok" role="status">Done. Your balance is updated.</p>{/if}
			<p class="meta">Balance: {coins(data.balance)} {data.market.currency} · Spend limit here: {data.market.spendCap == null ? 'none' : coins(data.market.spendCap)}</p>
		{:else}
			<p class="meta">{data.market.status === 'open' || data.market.status === 'closed' ? 'Trading is closed.' : 'Trading is not open for this market.'}</p>
		{/if}
	</section>

	<div class="body">
		<section class="card">
			<h2>Chance over time</h2>
			<div class="plot">
			<svg viewBox="0 0 {W} {H}" role="img" aria-label="Chance of each outcome over time" preserveAspectRatio="none" onpointermove={onHover} onpointerdown={onHover} onpointerleave={() => (hoverT = null)}>
				{#each [0.25, 0.5, 0.75] as g (g)}
					<line x1="0" x2={W} y1={y(g)} y2={y(g)} class="grid" />
				{/each}
				{#each paths as d, i (i)}
					<path {d} fill="none" stroke={colour(live[i], i)} stroke-width={i === idx ? 3.5 : 2} vector-effect="non-scaling-stroke" />
				{/each}
				{#if hoverX !== null}
					<line x1={hoverX} x2={hoverX} y1="0" y2={H} class="cursor" />
					{#each live as o, i (o.id)}
						<circle cx={hoverX} cy={y(probAt(i))} r="4" fill={colour(o, i)} />
					{/each}
				{/if}
			</svg>
				{#if hoverX !== null}
					<div class="tip" class:flip={hoverX / W > 0.6} style:left="{(hoverX / W) * 100}%">
						<p class="meta">{hoverWhen}</p>
						<ul>
							{#each live as o, i (o.id)}
								<li><span class="swatch" style:background={colour(o, i)}></span>{o.label}<strong>{pct(probAt(i))}</strong></li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
			<p class="meta readout" aria-live="polite">{hoverT === null ? 'Move across the chart to see the chance at any time.' : hoverWhen}</p>
			<ul class="legend">
				{#each live as o, i (o.id)}
					<li>
						<button type="button" class="legend-item" class:on={o.id === outcomeId} onclick={() => (picked = o.id)}>
							{#if o.imageFile}<img class="legend-pic" src="/market-images/{o.imageFile}" alt="" />{:else if o.avatar}<img class="legend-pic" src={o.avatar} alt="" />{:else}<span class="swatch" style:background={colour(o, i)}></span>{/if}
							{o.label} <span class="pct">{price(probAt(i))}</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<section class="card">
			<h2>Resolution</h2>
				{#if data.canModerate && !resolving}
					<button class="go" onclick={() => (resolving = true)}>Resolve market</button>
				{:else}
			<p>{data.market.criteria}</p>
			{#if data.market.disputeOpen}
				<p class="notice" role="status">Dispute window open until {when(data.market.disputeUntil!)}. Anyone can dispute this result under Report a problem, and a moderator can change it until then.</p>
			{/if}
			{#if data.market.resolvedOutcomeId}
				<p><strong>Winner:</strong> {live.find((o) => o.id === data.market.resolvedOutcomeId)?.label}</p>
			{/if}
			{#each data.proposals as p (p.id)}
				<div class="proposal">
					<p><strong>{p.outcome}</strong> {p.status === 'pending' ? 'proposed' : 'accepted'} by {p.proposer}, {when(p.createdAt)}</p>
					<p class="evidence">{#each linkify(p.evidence) as part}{#if part.href}<a href={part.href} rel="noopener noreferrer nofollow" target="_blank">{part.text}</a>{:else}{part.text}{/if}{/each}</p>
					{#if p.proofs.length}
						<ul class="proofs">
							{#each p.proofs as pf (pf.id)}
								<li>
									{#if pf.kind === 'link'}<a href={pf.url} rel="noopener noreferrer nofollow" target="_blank">{pf.label}</a>
									{:else if pf.kind === 'image'}<a href="/proofs/{pf.id}" target="_blank"><img src="/proofs/{pf.id}" alt={pf.label} loading="lazy" /></a> <span class="meta">{pf.label}</span>
									{:else}<a href="/proofs/{pf.id}" target="_blank" rel="noopener">{pf.label}</a>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if p.status === 'pending'}<p class="meta">Waiting for a moderator.</p>{/if}
				</div>
			{/each}
			{#if canPropose && data.market.onBreak}
				<p class="meta">You can't request a resolution while on a break.</p>
			{:else if canPropose}
				<form method="POST" action="?/propose" class="propose" enctype="multipart/form-data" use:enhance>
					<fieldset>
						<legend>Propose the result</legend>
						{#each live as o, i (o.id)}
							<label class="radio"><input type="radio" name="outcomeId" value={o.id} checked={i === 0} /> {o.label}</label>
						{/each}
					</fieldset>
					<label class="field">
						Description: explain the evidence. Links in it are clickable, and everyone can read it.
						<textarea name="evidence" rows="2" required maxlength="500"></textarea>
					</label>
					<label class="field">
						Proof: pictures or PDFs, up to 5 pieces in all, 5 MB each
						<input type="file" name="proofFile" multiple accept="image/png,image/jpeg,image/webp,application/pdf" />
					</label>
					<label class="field">
						Proof links, one per line (https only). Add a caption after a bar: https://example.com | Final score
						<textarea name="proofLinks" rows="2"></textarea>
					</label>
					<button class="go">Propose result</button>
					{#if form?.proposeError}<p class="error" role="alert">{form.proposeError}</p>{/if}
					{#if act && 'proposed' in act}<p class="ok" role="status">Sent. A moderator will look at it.</p>{/if}
				</form>
			{/if}
			<details class="report">
				<summary>Report a problem</summary>
				<form method="POST" action="?/report" use:enhance>
					<label class="field">
						What is wrong?
						<select name="kind">
							<option value="market">The market: its wording, criteria or close time</option>
							{#if data.market.disputeOpen}
								<option value="resolution">The result (dispute)</option>
							{/if}
						</select>
					</label>
					<label class="field">
						Tell the moderators what is wrong. Only moderators and admins read this.
						<textarea name="body" rows="3" required minlength="5" maxlength="1000"></textarea>
					</label>
					<button class="quiet">Send report</button>
					{#if form?.reportError}<p class="error" role="alert">{form.reportError}</p>{/if}
					{#if act && 'reported' in act}<p class="ok" role="status">Sent. A moderator will look at it.</p>{/if}
				</form>
			</details>
				{/if}
		</section>

		{#if data.positions.some((p) => p.shares > 0)}
			<section class="card">
				<h2>Your position</h2>
				<ul class="plain">
					{#each data.positions.filter((p) => p.shares > 0) as p (p.outcomeId)}
						<li>{live.find((o) => o.id === p.outcomeId)?.label}: {p.shares.toFixed(2)} shares, {coins(p.netSpent)} {data.market.currency} in</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="card">
			<h2>Trades</h2>
			{#if data.feed.length === 0}
				<p class="meta">No trades yet.</p>
			{:else}
				<ul class="plain feed">
					{#each data.feed as t (t.id)}
						<li>
							<span><a href="/users/{t.whoId}">{t.who}</a> {t.shares > 0 ? 'bought' : 'sold'} {Math.abs(t.shares).toFixed(2)} “{t.outcome}” for {coins(t.amount)} {data.market.currency}</span>
							<span class="meta">{pct(t.probAfter)} · {when(t.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card" aria-labelledby="comments-title">
			<h2 id="comments-title">Comments</h2>
			{#if canComment}
				<form method="POST" action="?/comment" use:enhance class="comment-form">
					<label class="field">
						<span class="sr">Your comment</span>
						<textarea name="body" rows="2" required maxlength="500" placeholder="Say why you think so. Be kind; keep it about the market."></textarea>
					</label>
					<button class="quiet">Post comment</button>
					{#if form?.commentError}<p class="error" role="alert">{form.commentError}</p>{/if}
				</form>
			{:else}
				<p class="meta">Comments open once the market is approved.</p>
			{/if}
			{#if data.comments.length === 0}
				<p class="meta">No comments yet.</p>
			{:else}
				<ul class="comments">
					{#each data.comments as c (c.id)}
						<li class:hidden={c.hidden}>
							<p class="who"><a href="/users/{c.whoId}">{c.who}</a> <span class="meta">{when(c.createdAt)}{c.hidden ? ' · hidden by a moderator' : ''}</span></p>
							<p class="body">{c.body}</p>
							{#if data.canModerate && !c.hidden}
								<form method="POST" action="?/hide" use:enhance>
									<input type="hidden" name="commentId" value={c.id} />
									<button class="quiet small">Hide</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	/* Phone: trade panel first, one column. Desktop: trade panel sticks to the right. Vault: Mobile experience. */
	.layout {
		display: grid;
		gap: 16px;
	}
	.body {
		display: grid;
		gap: 16px;
		align-content: start;
	}
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		display: grid;
		gap: 12px;
		align-content: start;
	}
.notice {
		background: var(--card-2);
		border-radius: 12px;
		padding: 12px;
		margin: 0;
	}
	.report {
		margin-top: 12px;
	}
	.report summary {
		color: var(--fg-2);
		font-size: 0.875rem;
		min-height: 44px;
		display: flex;
		align-items: center;
		cursor: pointer;
	}
	.card h2 {
		font-size: 1rem;
		margin: 0;
		font-weight: var(--weight-strong);
	}
	.head {
		position: relative;
		margin-bottom: 16px;
	}
	.head.framed {
		padding-right: var(--pic);
	}
	/* Square picture, out of the flow: its side is the header's height, so the header does not grow. */
	.head :global(.logo.large) {
		position: absolute;
		top: 0;
		right: 0;
		width: var(--pic);
		height: var(--pic);
		border-radius: 12px;
	}
	@media (max-width: 600px) {
		.head.framed {
			padding-right: 0;
		}
		.head :global(.logo.large) {
			position: static;
			width: 128px;
			height: 128px;
		}
	}
	.head h1 {
		margin: 4px 0 8px;
	}
	.meta,
	.status {
		color: var(--muted);
		font-size: 0.875rem;
		margin: 0;
	}
	.status {
		color: var(--fg-2);
	}
	.seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		background: var(--card-2);
		border-radius: var(--radius-pill);
		padding: 4px;
	}
	.seg button,
	.chip,
	.pick,
	.go {
		min-height: 44px;
		font: inherit;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--card);
		font-weight: var(--weight-strong);
	}
	/* Two options sit side by side; a multiple-choice market (up to 10) wraps into columns. */
	.outcomes-pick {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
	}
	.pick {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 12px;
		border: 2px solid transparent;
	}
	.pick.on {
		border-color: var(--fg-2);
	}
	.pct {
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-strong);
	}
	.chips {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}
	.chip.on {
		background: var(--fg);
		color: var(--bg);
	}
	form {
		display: grid;
		gap: 12px;
	}
	.field {
		display: grid;
		gap: 6px;
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	input[type='number'],
	textarea {
		font: inherit;
		font-weight: var(--weight);
		min-height: 44px;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
	}
	.go {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
	}
	.go:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.error {
		color: var(--no-text);
		margin: 0;
	}
	.ok {
		color: var(--yes-text);
		margin: 0;
	}
	svg {
		width: 100%;
		height: 200px;
		display: block;
		touch-action: pan-y;
		cursor: crosshair;
	}
	.cursor {
		stroke: var(--fg-2);
		stroke-width: 1;
	}
	.live {
		color: var(--yes-text);
		font-size: 0.8125rem;
		font-weight: var(--weight-strong);
	}
	.comment-form {
		display: grid;
		gap: 8px;
		margin-bottom: 12px;
	}
	.comment-form textarea {
		font: inherit;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
	}
	.comments {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}
	.comments li {
		border-top: 1px solid var(--border);
		padding-top: 10px;
	}
	.comments li.hidden .body {
		color: var(--muted);
		font-style: italic;
	}
	.comments p {
		margin: 0;
	}
	.comments .who {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
	}
	.comments a {
		color: inherit;
	}
	.small {
		min-height: 36px;
		padding: 0 12px;
		font-size: 0.8125rem;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.readout {
		min-height: 1.5em;
	}
	.plot {
		position: relative;
	}
	/* Floats over the chart at the hovered moment: the time and every outcome's chance then. */
	.tip {
		position: absolute;
		top: 8px;
		transform: translateX(12px);
		min-width: 180px;
		padding: 8px 12px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow-card);
		font-size: 0.8125rem;
		pointer-events: none;
	}
	.tip.flip {
		transform: translateX(calc(-100% - 12px));
	}
	.tip p {
		margin: 0 0 4px;
	}
	.tip ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.tip li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tip strong {
		margin-left: auto;
		padding-left: 12px;
		font-variant-numeric: tabular-nums;
	}
	.legend-item {
		font: inherit;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		cursor: pointer;
	}
	.legend-item.on {
		outline: 2px solid var(--fg);
	}
	.legend-pic,
	.pick-pic {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		object-fit: cover;
	}
	.quote {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		margin: 0;
		font-size: 0.875rem;
	}
	.quote dt {
		color: var(--muted);
	}
	.quote dd {
		margin: 0;
		font-weight: var(--weight-strong);
		text-align: right;
	}
	.hero {
		width: 100%;
		max-height: 220px;
		object-fit: cover;
		border-radius: var(--radius-card);
	}
	.grid {
		stroke: var(--border);
		stroke-dasharray: 4 4;
	}
	.legend {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		font-size: 0.875rem;
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 6px;
	}
	.plain {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 10px;
	}
	.feed li {
		display: grid;
		gap: 2px;
		font-size: 0.875rem;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}
	.proposal p {
		margin: 0 0 4px;
	}
	.proofs {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.proofs img {
		max-width: 100%;
		max-height: 180px;
		border-radius: 8px;
		display: block;
	}
	.evidence {
		overflow-wrap: anywhere;
	}
	.propose fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 6px;
	}
	.propose legend {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		padding: 0;
		margin-bottom: 6px;
	}
	.radio {
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	a {
		color: inherit;
	}

	/* Buying sits below the chart and the rest of the page, so the chart leads. */
	.trade {
		order: 1;
	}
</style>
