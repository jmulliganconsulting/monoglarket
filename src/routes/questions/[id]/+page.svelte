<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import PriceChart from '#lib/PriceChart.svelte';
	import { coins, dateTime } from '#lib/format.ts';
	import { floorCoins, floorShares, proceedsForSell, sharesForSpend } from '../../../engine/lmsr.ts';
	import { netOfFee } from '../../../engine/fees.ts';
	import { parseRange, rangeHolds } from '../../../markets/ranges.ts';
	import { fromInput, readWhen, whenHolds } from '../../../markets/when.ts';
	import ZoneSelect from '#lib/ZoneSelect.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	type Option = (typeof data.options)[number];
	type Side = 'yes' | 'no';
	const YES = '#3669f6';
	const NO = '#ce2c8a';

	const pct = (p: number | null) => (p === null ? '—' : p > 0 && p < 0.01 ? '<1%' : p > 0.99 && p < 1 ? '>99%' : `${Math.round(p * 100)}%`);
	const settled = (o: Option) => o.result !== null;
	const statusText = (s: string) => ({ pending_review: 'Waiting for approval', closed: 'Trading ended', locked: 'Locked by a moderator', cancelled: 'Cancelled', rejected: 'Not approved' })[s] ?? null;

	// Chance a day ago, from the option's own line, for the small up/down change beside its chance.
	const DAY = 86_400_000;
	const probAt = (points: { t: number; p: number }[], t: number) => points.reduce((p, pt) => (pt.t <= t ? pt.p : p), points[0]?.p ?? 0);
	const change = (i: number) => {
		const o = data.options[i];
		if (o.probability === null || settled(o)) return 0;
		return Math.round((o.probability - probAt(data.chart[i].points, Date.now() - DAY)) * 100);
	};
	// One option's own chart: Yes and No over time.
	const own = (i: number) => [
		{ label: 'Yes', color: YES, points: data.chart[i].points },
		{ label: 'No', color: NO, points: data.chart[i].points.map((pt) => ({ t: pt.t, p: 1 - pt.p })) },
	];
	let expanded = $state<number | null>(null);

	// The ticket on the right trades one option at a time. It quotes the same LMSR trade the market's actions run;
	// the server still enforces the minimum shares and proceeds.
	// svelte-ignore state_referenced_locally
	let sel = $state<{ marketId: number; side: Side }>({ marketId: (data.options.find((o) => o.tradable) ?? data.options[0]).marketId, side: 'yes' });
	let mode = $state<'buy' | 'sell'>('buy');
	// Phones show the ticket as a sheet once a side is picked.
	let sheet = $state(false);
	let spend = $state(10);
	const spendOk = $derived(Number.isSafeInteger(spend) && spend > 0);
	// One idempotency key per submitted trade, so a double tap can't pay twice (ADR-006).
	let key = $state(crypto.randomUUID());
	let notice = $state<{ text: string; ok: boolean } | null>(null);
	const current = $derived(data.options.find((o) => o.marketId === sel.marketId) ?? data.options[0]);
	const idx = $derived(sel.side === 'yes' ? 0 : 1);
	const choose = (o: Option, side: Side) => {
		sel = { marketId: o.marketId, side };
		notice = null;
		sheet = true;
	};
	const buyQuote = $derived.by(() => {
		const shares = spendOk ? floorShares(sharesForSpend(current.q, current.b, idx, spend)) : 0;
		return { shares, min: floorShares(shares * 0.98), win: floorCoins(shares) };
	});
	const held = $derived(current.held[idx] ?? 0);
	const sellQuote = $derived(held > 0 ? netOfFee(floorCoins(proceedsForSell(current.q, current.b, idx, floorShares(held)))) : 0);
	const trade: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success') {
			notice = { text: mode === 'buy' ? 'Bought. Your balance is updated.' : 'Sold. Your balance is updated.', ok: true };
			key = crypto.randomUUID();
			await invalidateAll();
		} else if (result.type === 'failure') {
			notice = { text: String(result.data?.tradeError ?? result.data?.error ?? 'That did not go through.'), ok: false };
		} else {
			await update();
		}
	};

	// Resolving: every open option settles from one form.
	const open = $derived(data.options.filter((o) => ['open', 'closed', 'locked'].includes(o.status)));
	let answer = $state('');
	const answerRange = $derived(parseRange(answer));
	const answerOk = $derived(!!answerRange && Number.isFinite(answerRange.lo) && Number.isFinite(answerRange.hi));
	const wouldWin = (o: Option) => {
		const r = parseRange(o.label);
		return answerOk && !!r && rangeHolds(r, answerRange!);
	};
	let ticked = $state<number[]>([]);
	const confirmResolve = (e: SubmitEvent) => {
		if (!confirm('Settle every open option now? Winners are paid at once, and each result can be disputed for 24 hours.')) e.preventDefault();
	};
	const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	// svelte-ignore state_referenced_locally
	let noClose = $state(data.closeAt === null);
	// svelte-ignore state_referenced_locally
	let closeLocal = $state(localInput(new Date(data.closeAt ?? Date.now() + 7 * DAY)));
	const closeAt = $derived.by(() => {
		const t = noClose || !closeTz ? NaN : fromInput(closeLocal, closeTz);
		return Number.isNaN(t) ? '' : new Date(t).toISOString();
	});
	// The zone the close time is typed in: the browser's own unless changed.
	let closeTz = $state('');
	const f = $derived(form as ActionData | undefined);

	// A date question settles from when it happened. With times in the options, that's a date and time in a zone the moderator
	// picks; with whole days only, it's a day in the creator's zone (the zone the days were set in). Older "on"/"by" options have
	// no span: they show no preview and take a time like a timed question.
	const spans = $derived(data.options.map((o) => readWhen(o.optionRange)));
	const dayZone = $derived(spans.every((w) => w && !w.time) ? spans[0]!.tz : null);
	let whenTz = $state('');
	// svelte-ignore state_referenced_locally
	let whenInput = $state(localInput(new Date()).slice(0, dayZone ? 10 : 16));
	const whenAt = $derived(fromInput(whenInput, dayZone ?? whenTz));
	const dayWins = (o: Option) => {
		const w = readWhen(o.optionRange);
		return !!w && !Number.isNaN(whenAt) && whenHolds(w, new Date(whenAt));
	};
	const answerText = (answer: string) =>
		data.kind !== 'date' ? answer : dayZone ? new Date(answer).toLocaleDateString(undefined, { timeZone: dayZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : dateTime(new Date(answer));
</script>

<svelte:head><title>{data.question} · Monoglarket</title></svelte:head>

<div class="layout">
	<div class="main">
		<header class="head">
			{#if data.image}<img class="icon" src="/market-images/{data.image}" alt="" />{/if}
			<div>
				<p class="meta">{data.kind === 'numeric' ? 'Number' : data.kind === 'date' ? 'Date' : 'Several options'}{data.creator ? `, proposed by ${data.creator}` : ''}</p>
				<h1>{data.question}</h1>
			</div>
		</header>

		{#if data.answer || data.winners.length}
			<p class="result">
				{#if data.answer}Resolved at <strong>{answerText(data.answer)}</strong>.{/if}
				{#if data.winners.length}Won: <strong>{data.winners.join(', ')}</strong>{:else if data.answer} No range held it.{/if}
			</p>
		{/if}

		<section class="chart" aria-label="Chance over time">
			<PriceChart series={data.chart} end={data.chartEnd} />
		</section>

		<ul class="options">
			{#each data.options as o, i (o.marketId)}
				{@const d = change(i)}
				<li class="option" class:picked={sel.marketId === o.marketId}>
					<button type="button" class="name" aria-expanded={expanded === i} onclick={() => (expanded = expanded === i ? null : i)}>
						<span class="label">{o.label}</span>
						{#if statusText(o.status)}<span class="meta">{statusText(o.status)}</span>{/if}
					</button>
					{#if settled(o)}
						<span class="verdict" class:won={o.won}>{o.won ? 'Yes' : 'No'}<span class="mark" aria-hidden="true">{o.won ? '✓' : '✕'}</span></span>
					{:else}
						<span class="chance">
							{pct(o.probability)}
							{#if d !== 0}<span class="delta" class:up={d > 0}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}%</span>{/if}
						</span>
						<div class="sides">
							<button type="button" class="side yes" class:on={sheet && sel.marketId === o.marketId && sel.side === 'yes'} disabled={!o.tradable} onclick={() => choose(o, 'yes')}>Yes {pct(o.probability)}</button>
							<button type="button" class="side no" class:on={sheet && sel.marketId === o.marketId && sel.side === 'no'} disabled={!o.tradable} onclick={() => choose(o, 'no')}>No {pct(o.probability === null ? null : 1 - o.probability)}</button>
						</div>
					{/if}
					{#if expanded === i}
						<div class="detail">
							<PriceChart series={own(i)} end={data.chartEnd} />
							<a href="/markets/{o.marketId}">Open this option's market, with its trades and comments</a>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<details class="fold" open>
			<summary>Rules</summary>
			<p>{data.criteria}</p>
			<p class="meta">
				{#if data.kind === 'numeric'}Each range is its own Yes/No market. When the final number is in, every range that holds it resolves Yes and the rest resolve No.
				{:else if data.kind === 'date'}Each day or range of days is its own Yes/No market. When the day it happened is in, every option that holds it resolves Yes and the rest resolve No.
				{:else}Each option is its own Yes/No market, so more than one can win.{/if}
			</p>
		</details>

		<details class="fold" open>
			<summary>Timeline</summary>
			<ol class="timeline">
				<li class="done"><strong>Opened</strong><span>{dateTime(data.createdAt)}</span></li>
				<li class:done={data.closeAt && new Date(data.closeAt) <= new Date()}><strong>Trading ends</strong><span>{data.closeAt ? dateTime(data.closeAt) : 'No end time: trading runs until a moderator resolves it'}</span></li>
				<li class:done={!!data.resolvedAt}><strong>Resolved</strong><span>{data.resolvedAt ? `${dateTime(data.resolvedAt)}. Disputes are open for 24 hours.` : 'Winners are paid as soon as it resolves'}</span></li>
			</ol>
		</details>

		{#if data.canEdit}
			<details class="fold">
				<summary>Edit question</summary>
				<form class="stack" method="POST" action="?/edit" use:enhance>
					<label class="field">Question <input name="question" required maxlength="200" value={data.question} /></label>
					<label class="field">How it resolves <textarea name="criteria" required rows="3" maxlength="1000">{data.criteria}</textarea></label>
					<label class="field">
						Category
						<select name="categoryId">
							<option value="">None</option>
							{#each data.categories as c (c.id)}<option value={c.id} selected={c.id === data.categoryId}>{c.name}</option>{/each}
						</select>
					</label>
					<label class="field">
						Trading ends
						<input type="datetime-local" bind:value={closeLocal} required={!noClose} disabled={noClose} />
						<input type="hidden" name="closeAt" value={closeAt} />
					</label>
					<ZoneSelect bind:value={closeTz} name="" />
					<label class="check"><input type="checkbox" bind:checked={noClose} /> No end time</label>
					<button class="go">Save for every option</button>
				</form>
				{#if f?.saved}<p role="status">Saved for every option.</p>{/if}
			</details>
		{/if}
	</div>

	<aside class="side-col">
		{#if data.canApprove}
			<section class="card">
				<h2>Waiting for approval</h2>
				<p class="meta">Approving opens every option that is still waiting, together.</p>
				<form method="POST" action="?/approve" use:enhance><button class="go">Approve all options</button></form>
				{#if f?.approved}<p role="status">Approved. Trading is open on every option.</p>{/if}
			</section>
		{/if}

		{#if data.canResolve}
			<section class="card">
				<h2>Resolve</h2>
				{#if data.kind === 'numeric'}
					<form class="stack" method="POST" action="?/resolveNumeric" use:enhance onsubmit={confirmResolve}>
						<label class="field">
							Final number, or a range if that's all you know
							<input name="answer" bind:value={answer} required inputmode="decimal" placeholder="27" autocomplete="off" />
						</label>
						{#if answer.trim()}
							{#if answerOk}
								<ul class="preview">
									{#each open as o (o.marketId)}<li class:win={wouldWin(o)}>{o.label}<span>{wouldWin(o) ? 'Yes' : 'No'}</span></li>{/each}
								</ul>
							{:else}
								<p class="error">Enter a number like 27, or a range like 20-21.</p>
							{/if}
						{/if}
						<button class="go" disabled={!answerOk}>Resolve all {open.length} options</button>
					</form>
				{:else if data.kind === 'date'}
					<form class="stack" method="POST" action="?/resolveDate" use:enhance onsubmit={confirmResolve}>
						<label class="field">
							{dayZone ? `The day it happened (days run midnight to midnight, ${dayZone.replaceAll('_', ' ')})` : 'When it happened'}
							{#if dayZone}<input type="date" bind:value={whenInput} required />{:else}<input type="datetime-local" bind:value={whenInput} required />{/if}
							<input type="hidden" name="at" value={Number.isNaN(whenAt) ? '' : new Date(whenAt).toISOString()} />
						</label>
						{#if !dayZone}<ZoneSelect bind:value={whenTz} name="" />{/if}
						{#if !Number.isNaN(whenAt) && open.some((o) => o.dateMatch === 'range')}
							<ul class="preview">
								{#each open as o (o.marketId)}<li class:win={dayWins(o)}>{o.label}<span>{dayWins(o) ? 'Yes' : 'No'}</span></li>{/each}
							</ul>
						{/if}
						<button class="go" disabled={Number.isNaN(whenAt)}>Resolve all {open.length} options</button>
					</form>
				{:else}
					<form class="stack" method="POST" action="?/resolveOptions" use:enhance onsubmit={confirmResolve}>
						<fieldset class="ticks">
							<legend class="meta">Tick every option that won. The rest resolve No.</legend>
							{#each open as o (o.marketId)}
								<label class="tick"><input type="checkbox" name="winner" value={o.marketId} bind:group={ticked} />{o.label}</label>
							{/each}
						</fieldset>
						<button class="go">Resolve: {ticked.length} won, {open.length - ticked.length} lost</button>
					</form>
				{/if}
				{#if f?.resolved}<p role="status">Resolved. Winners are paid.</p>{/if}
			</section>
		{/if}
		{#if f?.error}<p class="error card" role="alert">{f.error}</p>{/if}

		{#if data.options.some((o) => o.tradable)}
			<section class="card ticket" class:show={sheet} aria-label="Trade">
				<header class="ticket-head">
					<div>
						<p class="meta">{data.question}</p>
						<p class="ticket-option">{current.label}</p>
					</div>
					<button type="button" class="close" aria-label="Close" onclick={() => (sheet = false)}>✕</button>
				</header>
				<div class="tabs" role="tablist">
					<button type="button" role="tab" aria-selected={mode === 'buy'} onclick={() => (mode = 'buy')}>Buy</button>
					<button type="button" role="tab" aria-selected={mode === 'sell'} onclick={() => (mode = 'sell')}>Sell</button>
				</div>
				<div class="pair">
					<button type="button" class="side yes big" class:on={sel.side === 'yes'} disabled={!current.tradable} onclick={() => (sel.side = 'yes')}>Yes {pct(current.probability)}</button>
					<button type="button" class="side no big" class:on={sel.side === 'no'} disabled={!current.tradable} onclick={() => (sel.side = 'no')}>No {pct(current.probability === null ? null : 1 - current.probability)}</button>
				</div>
				{#if mode === 'buy'}
					<form class="stack" method="POST" action="/markets/{current.marketId}?/buy" use:enhance={trade}>
						<input type="hidden" name="outcomeId" value={current.outcomeIds[idx]} />
						<input type="hidden" name="key" value={key} />
						<input type="hidden" name="minShares" value={buyQuote.min} />
						<label class="amount">
							Amount
							<input name="spend" type="number" inputmode="numeric" min="1" step="1" bind:value={spend} />
						</label>
						<div class="chips">
							{#each [10, 25, 100] as amt (amt)}<button type="button" class="chip" onclick={() => (spend = (spendOk ? spend : 0) + amt)}>+{amt}</button>{/each}
						</div>
						<p class="quote">
							{#if buyQuote.shares > 0}<span>To win</span><strong>{coins(buyQuote.win)}</strong>{:else}<span>Enter an amount to see the quote.</span>{/if}
						</p>
						<button class="go" disabled={!current.tradable || buyQuote.shares <= 0}>Buy {sel.side === 'yes' ? 'Yes' : 'No'}</button>
					</form>
				{:else}
					<form class="stack" method="POST" action="/markets/{current.marketId}?/sell" use:enhance={trade}>
						<input type="hidden" name="outcomeId" value={current.outcomeIds[idx]} />
						<input type="hidden" name="key" value={key} />
						<input type="hidden" name="shares" value="all" />
						<input type="hidden" name="minProceeds" value={floorCoins(sellQuote * 0.98)} />
						<p class="quote"><span>You hold</span><strong>{held.toFixed(2)} {sel.side === 'yes' ? 'Yes' : 'No'}</strong></p>
						<p class="quote"><span>You get, after the fee</span><strong>{coins(sellQuote)}</strong></p>
						<button class="go" disabled={!current.tradable || sellQuote <= 0}>Sell all</button>
					</form>
				{/if}
				{#if notice}<p class={notice.ok ? 'ok' : 'error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>{/if}
			</section>
		{/if}
	</aside>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 32px;
		align-items: start;
	}
	.main {
		min-width: 0;
	}
	.side-col {
		position: sticky;
		top: 16px;
		display: grid;
		gap: 16px;
	}
	.head {
		display: flex;
		gap: 14px;
		align-items: center;
		margin-bottom: 12px;
	}
	.head h1 {
		margin: 0;
	}
	.icon {
		width: 64px;
		height: 64px;
		border-radius: 14px;
		object-fit: cover;
		flex: none;
	}
	.meta {
		color: var(--muted);
		font-size: 0.8125rem;
		margin: 0;
	}
	.result {
		margin: 0 0 16px;
		padding: 10px 14px;
		border-radius: var(--radius-pill);
		background: var(--card-2);
	}
	.chart {
		margin-bottom: 8px;
	}
	/* Rows: name on the left, the big chance in the middle, Yes and No on the right. */
	.options {
		list-style: none;
		margin: 0 0 24px;
		padding: 0;
	}
	.option {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 140px 272px;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border-top: 1px solid var(--border);
	}
	.option:last-child {
		border-bottom: 1px solid var(--border);
	}
	.name {
		all: unset;
		display: grid;
		gap: 2px;
		cursor: pointer;
		min-height: 44px;
		align-content: center;
		border-radius: 8px;
	}
	.name:focus-visible {
		outline: 2px solid var(--brand-text);
		outline-offset: 2px;
	}
	.label {
		font-weight: var(--weight-strong);
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
	}
	.name:hover .label {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	/* The one loud thing on the page: each option's chance, set in the condensed display face. */
	.chance {
		font-family: var(--font-display);
		font-stretch: var(--stretch-display);
		font-size: 2rem;
		font-weight: 650;
		line-height: 1;
		text-align: center;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.delta {
		display: block;
		font-family: var(--font);
		font-stretch: normal;
		font-size: 0.75rem;
		font-weight: var(--weight-strong);
		color: var(--no-text);
		margin-top: 2px;
	}
	.delta.up {
		color: var(--yes-text);
	}
	.sides,
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.side {
		font: inherit;
		font-weight: var(--weight-strong);
		min-height: 44px;
		border: 0;
		border-radius: var(--radius-pill);
		cursor: pointer;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		transition: background-color 120ms var(--ease);
	}
	.side.yes {
		background: color-mix(in srgb, var(--yes) 16%, transparent);
		color: var(--yes-text);
	}
	.side.no {
		background: color-mix(in srgb, var(--no) 16%, transparent);
		color: var(--no-text);
	}
	.side.yes:hover:not(:disabled) {
		background: color-mix(in srgb, var(--yes) 26%, transparent);
	}
	.side.no:hover:not(:disabled) {
		background: color-mix(in srgb, var(--no) 26%, transparent);
	}
	.side.yes.on {
		background: var(--yes);
		color: #fff;
	}
	.side.no.on {
		background: var(--no);
		color: #fff;
	}
	.side:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.side:focus-visible,
	.go:focus-visible,
	.chip:focus-visible,
	.tabs button:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	.side.big {
		min-height: 52px;
		font-size: 1rem;
	}
	.verdict {
		grid-column: 2 / -1;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: var(--weight-strong);
	}
	.mark {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--no);
		color: #fff;
		font-size: 0.75rem;
	}
	.verdict.won .mark {
		background: var(--yes);
	}
	.detail {
		grid-column: 1 / -1;
		display: grid;
		gap: 8px;
		padding: 4px 0 8px;
	}
	.detail a {
		color: var(--brand-text);
		font-size: 0.875rem;
	}

	.fold {
		border-top: 1px solid var(--border);
		padding: 16px 0;
	}
	.fold summary {
		font-weight: var(--weight-strong);
		font-size: 1.125rem;
		cursor: pointer;
		min-height: 32px;
	}
	.fold p {
		max-width: 70ch;
	}
	.timeline {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
	}
	.timeline li {
		position: relative;
		display: grid;
		padding: 0 0 16px 28px;
	}
	.timeline li::before {
		content: '';
		position: absolute;
		left: 4px;
		top: 6px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--muted);
	}
	.timeline li:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 8px;
		top: 20px;
		bottom: 0;
		width: 2px;
		background: var(--border);
	}
	.timeline li.done::before {
		background: var(--yes);
		box-shadow: 0 0 0 2px var(--yes);
	}
	.timeline span {
		color: var(--muted);
	}

	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		margin: 0;
	}
	.card h2 {
		font-size: 1rem;
		margin: 0 0 10px;
	}
	.stack {
		display: grid;
		gap: 12px;
	}
	.field {
		display: grid;
		gap: 6px;
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	.field input,
	.field select,
	.field textarea,
	.amount input {
		font: inherit;
		font-weight: var(--weight);
		min-height: 44px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 8px 12px;
		background: var(--card-2);
		color: var(--fg);
	}
	.check,
	.tick {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
	}
	.tick input {
		width: 18px;
		height: 18px;
	}
	.ticks {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.ticks legend {
		margin-bottom: 6px;
	}
	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
		font-size: 0.875rem;
	}
	.preview li {
		display: flex;
		justify-content: space-between;
		padding: 6px 10px;
		border-radius: 8px;
		color: var(--muted);
	}
	.preview li.win {
		background: color-mix(in srgb, var(--yes) 16%, transparent);
		color: var(--yes-text);
		font-weight: var(--weight-strong);
	}
	.go {
		font: inherit;
		font-weight: var(--weight-strong);
		min-height: 48px;
		padding: 8px 16px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: #fff;
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.ticket {
		display: grid;
		gap: 14px;
	}
	.ticket-head {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.ticket-head .meta {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 260px;
	}
	.ticket-option {
		margin: 0;
		font-weight: var(--weight-strong);
		font-size: 1.125rem;
	}
	.close {
		display: none;
	}
	.tabs {
		display: flex;
		gap: 18px;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		all: unset;
		cursor: pointer;
		padding: 6px 0 10px;
		color: var(--muted);
		font-weight: var(--weight-strong);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button[aria-selected='true'] {
		color: var(--fg);
		border-color: var(--fg);
	}
	.amount {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 12px;
		font-weight: var(--weight-strong);
	}
	.amount input {
		text-align: right;
		font-family: var(--font-display);
		font-stretch: var(--stretch-display);
		font-size: 1.75rem;
		font-weight: 650;
		background: transparent;
		border: 0;
		padding: 0;
	}
	.chips {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.chip {
		font: inherit;
		font-weight: var(--weight-strong);
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: transparent;
		color: var(--fg);
		cursor: pointer;
	}
	.quote {
		display: flex;
		justify-content: space-between;
		margin: 0;
		color: var(--muted);
	}
	.quote strong {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.ok {
		color: var(--yes-text);
		margin: 0;
	}
	.error {
		color: var(--no-text);
		margin: 0;
	}

	@media (max-width: 960px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.side-col {
			position: static;
		}
		/* On phones the ticket is a sheet from the bottom, shown once a Yes or No is picked. */
		.ticket {
			display: none;
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 20;
			border-radius: var(--radius-card) var(--radius-card) 0 0;
			padding-bottom: calc(16px + env(safe-area-inset-bottom));
			max-height: 85vh;
			overflow: auto;
		}
		.ticket.show {
			display: grid;
		}
		.close {
			display: block;
			font: inherit;
			min-width: 44px;
			min-height: 44px;
			border: 0;
			border-radius: 50%;
			background: var(--card-2);
			color: var(--fg);
			cursor: pointer;
		}
	}
	@media (max-width: 640px) {
		.option {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.sides {
			grid-column: 1 / -1;
		}
		.chance {
			font-size: 1.75rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.side {
			transition: none;
		}
	}
</style>
