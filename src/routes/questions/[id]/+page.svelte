<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import PriceChart from '#lib/PriceChart.svelte';
	import { coins, dateTime } from '#lib/format.ts';
	import { floorCoins, floorShares, sharesForSpend } from '../../../engine/lmsr.ts';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const when = dateTime;

	// Inline buying: Yes or No opens a ticket under that option. It quotes the same LMSR trade the market's buy action runs,
	// and the server still enforces the minimum shares.
	type Option = (typeof data.options)[number];
	let bet = $state<{ marketId: number; side: 'yes' | 'no' } | null>(null);
	let spend = $state(10);
	let spendOk = $derived(Number.isSafeInteger(spend) && spend > 0);
	// One idempotency key per submitted trade, so a double tap can't pay twice (ADR-006).
	let key = $state(crypto.randomUUID());
	let notice = $state<{ marketId: number; text: string; ok: boolean } | null>(null);
	const choose = (marketId: number, side: 'yes' | 'no') => {
		bet = bet?.marketId === marketId && bet.side === side ? null : { marketId, side };
		notice = null;
	};
	const quote = (o: Option, side: 'yes' | 'no') => {
		const shares = spendOk ? floorShares(sharesForSpend(o.q, o.b, side === 'yes' ? 0 : 1, spend)) : 0;
		return { shares, min: floorShares(shares * 0.98), win: floorCoins(shares) };
	};
	const buy = (marketId: number): SubmitFunction => () => async ({ result, update }) => {
		if (result.type === 'success') {
			notice = { marketId, text: 'Done. Your balance is updated.', ok: true };
			bet = null;
			key = crypto.randomUUID();
			await invalidateAll();
		} else if (result.type === 'failure') {
			notice = { marketId, text: String(result.data?.tradeError ?? 'That did not go through.'), ok: false };
		} else {
			await update();
		}
	};
	const pct = (p: number | null) => (p === null ? '—' : `${Math.round(p * 100)}%`);
	const statusText = (s: string) =>
		({ pending_review: 'Waiting for approval', open: 'Open', closed: 'Closed', resolved: 'Resolved', final: 'Final', cancelled: 'Cancelled', rejected: 'Not approved' })[s] ?? s;
	const approved = $derived((form as ActionData | undefined)?.approved);
	// datetime-local has no zone, so send the browser's local time as UTC ISO
	// The close time as the browser's local time, for datetime-local inputs.
	const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	// svelte-ignore state_referenced_locally
	let noClose = $state(data.closeAt === null);
	// svelte-ignore state_referenced_locally
	let closeLocal = $state(localInput(new Date(data.closeAt ?? Date.now() + 7 * 86_400_000)));
	const closeAt = $derived(!noClose && closeLocal && !Number.isNaN(Date.parse(closeLocal)) ? new Date(closeLocal).toISOString() : '');
	let whenLocal = $state(localInput(new Date()));
	const whenAt = $derived(whenLocal && !Number.isNaN(Date.parse(whenLocal)) ? new Date(whenLocal).toISOString() : '');
</script>

<svelte:head><title>{data.question} · MonoGlarket</title></svelte:head>

<header class="head">
	<p class="meta">{data.isDate ? 'Date question' : 'Several-winner question'}{data.creator ? ` · proposed by ${data.creator}` : ''}</p>
	<h1>{data.question}</h1>
	{#if data.winners.length}<p class="winner">Won: <strong>{data.winners.join(', ')}</strong></p>{/if}
	<p class="meta">{data.closeAt ? `Closes ${when(data.closeAt)}` : 'No set close date'}. Each option below is its own yes/no market: several can win.</p>
</header>

<section class="card">
	<h2>How it resolves</h2>
	<p>{data.criteria}</p>
</section>

{#if data.canEdit}
	<details class="card edit">
		<summary><h2>Edit question</h2></summary>
		<p class="meta">One save changes the question, how it resolves, its category and when it closes, for every option.</p>
		<form method="POST" action="?/edit" use:enhance>
			<label class="field">
				Question
				<input name="question" required maxlength="200" value={data.question} />
			</label>
			<label class="field">
				How it resolves
				<textarea name="criteria" required rows="3" maxlength="1000">{data.criteria}</textarea>
			</label>
			<label class="field">
				Category
				<select name="categoryId">
					<option value="">None</option>
					{#each data.categories as c (c.id)}<option value={c.id} selected={c.id === data.categoryId}>{c.name}</option>{/each}
				</select>
			</label>
			<label class="field">
				Closes at
				<input type="datetime-local" bind:value={closeLocal} required={!noClose} disabled={noClose} />
				<input type="hidden" name="closeAt" value={closeAt} />
				<label class="choice"><input type="checkbox" bind:checked={noClose} /> No set close date</label>
			</label>
			<button class="go">Save for every option</button>
		</form>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved}<p role="status">Saved. Every option has the new question, criteria and close time.</p>{/if}
	</details>
{/if}

{#if data.canResolveDate}
	<section class="card">
		<h2>Resolve by date</h2>
		<p class="meta">Enter when it happened. Every open option is settled at once, from that one time.</p>
		<form method="POST" action="?/resolveDate" use:enhance onsubmit={(e) => { if (!confirm('Settle every open option now? Winners are paid at once, and each result can be disputed for 24 hours.')) e.preventDefault(); }}>
			<label class="field">
				When it happened
				<input type="datetime-local" bind:value={whenLocal} required />
				<input type="hidden" name="at" value={whenAt} />
			</label>
			<button class="go">Resolve by date</button>
		</form>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.resolved}<p role="status">Resolved. Winners are paid.</p>{/if}
	</section>
{/if}

{#if data.canApprove}
	<section class="card">
		<h2>Moderation</h2>
		<p class="meta">Approving opens every option that is still waiting, together.</p>
		<form method="POST" action="?/approve" use:enhance>
			<button class="go">Approve all options</button>
		</form>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if approved}<p role="status">Approved. Trading is open on every option.</p>{/if}
	</section>
{/if}

<section class="card">
	<h2>Chance over time</h2>
	<PriceChart series={data.chart} end={data.chartEnd} />
</section>

<section>
	<h2>Options</h2>
	<ul class="options">
		{#each data.options as o (o.marketId)}
			<li class="option">
				<div class="name">
					<a href="/markets/{o.marketId}">{o.label}</a>
					<p class="meta">{statusText(o.status)}{o.result ? (o.won ? ' · won' : ' · lost') : ''}</p>
				</div>
				<p class="chance" aria-label="Chance of {o.yesLabel}">{pct(o.probability)}</p>
				<button type="button" class="pick" disabled={!o.tradable} aria-expanded={bet?.marketId === o.marketId && bet.side === 'yes'} onclick={() => choose(o.marketId, 'yes')}>Yes {pct(o.probability)}</button>
				<button type="button" class="pick" disabled={!o.tradable} aria-expanded={bet?.marketId === o.marketId && bet.side === 'no'} onclick={() => choose(o.marketId, 'no')}>No {pct(o.probability === null ? null : 1 - o.probability)}</button>
				{#if notice?.marketId === o.marketId}
					<p class="notice {notice.ok ? 'ok' : 'error'}" role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>
				{/if}
				{#if bet?.marketId === o.marketId}
					{@const q = quote(o, bet.side)}
					<form class="ticket" method="POST" action="/markets/{o.marketId}?/buy" use:enhance={buy(o.marketId)}>
						<input type="hidden" name="outcomeId" value={o.outcomeIds[bet.side === 'yes' ? 0 : 1]} />
						<input type="hidden" name="key" value={key} />
						<input type="hidden" name="minShares" value={q.min} />
						<div class="chips" role="group" aria-label="Amount">
							{#each [10, 25, 50, 100] as amt (amt)}
								<button type="button" class="chip" class:on={spend === amt} onclick={() => (spend = amt)}>{amt}</button>
							{/each}
						</div>
						<label class="field">
							Spend
							<input name="spend" type="number" inputmode="numeric" min="1" step="1" bind:value={spend} />
						</label>
						<p class="meta">{q.shares > 0 ? `About ${q.shares.toFixed(2)} shares. To win ${coins(q.win)}. Fills only if you get at least ${q.min.toFixed(2)}.` : 'Enter an amount to see the quote.'}</p>
						<button class="go" disabled={!spendOk || q.shares <= 0}>Buy {bet.side === 'yes' ? 'Yes' : 'No'} on “{o.label}”</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.head {
		margin-bottom: 16px;
	}
	.card {
		margin-bottom: 16px;
	}
	.options {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	/* One row per option, like a multi-date market: name and chance on the left, Yes and No on the right. */
	.options {
		border-bottom: 1px solid var(--border);
	}
	.option {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 110px 150px 150px;
		align-items: center;
		gap: 12px;
		padding: 14px 0;
		border-top: 1px solid var(--border);
	}
	.option a {
		color: var(--fg);
		text-decoration: none;
	}
	.option p {
		margin: 0;
	}
	.chance {
		font-size: 1.75rem;
		font-weight: var(--weight-strong);
		text-align: center;
		white-space: nowrap;
	}
	/* Yes and No are the buy buttons: each shows its side and price, and opens the trade panel with that side picked. */
	.pick {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 2px 0 var(--border);
		background: var(--card);
		color: var(--fg);
		font-weight: var(--weight-strong);
		white-space: nowrap;
		text-decoration: none;
	}
	button.pick {
		font: inherit;
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	button.pick:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.pick[aria-expanded='true'] {
		outline: 2px solid var(--fg);
	}
	/* The inline ticket opens under the row it belongs to. */
	.ticket,
	.notice {
		grid-column: 1 / -1;
	}
	.ticket {
		display: grid;
		gap: 10px;
		padding: 12px;
		background: var(--card-2);
		border-radius: 12px;
	}
	.ticket p {
		margin: 0;
	}
	.chips {
		display: flex;
		gap: 6px;
	}
	.chip {
		min-height: 44px;
		min-width: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
		font: inherit;
		cursor: pointer;
	}
	.chip.on {
		font-weight: var(--weight-strong);
		outline: 2px solid var(--fg);
	}
	.ok {
		color: var(--yes-text, #1e7b34);
	}
	@media (max-width: 600px) {
		.option {
			grid-template-columns: minmax(0, 1fr) auto auto;
		}
		.chance {
			display: none;
		}
	}
	.error {
		color: var(--no-text);
	}
	.go {
		font: inherit;
		font-weight: var(--weight-strong);
		min-height: 44px;
		padding: 8px 16px;
		border: 0;
		border-radius: 12px;
		background: var(--fg);
		color: var(--bg);
		cursor: pointer;
	}
</style>
