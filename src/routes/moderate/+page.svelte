<script lang="ts">
	import { coins, dateTime } from '#lib/format.ts';
	import { goto } from '$app/navigation';
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const when = dateTime;
	// The time picker gives local time; the hidden field carries it as ISO, the same as the server reads elsewhere.
	const localToIso = (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		const hidden = input.nextElementSibling as HTMLInputElement;
		hidden.value = input.value ? new Date(input.value).toISOString() : '';
	};
	// Stops the submit before it is sent when the moderator backs out.
	const confirmFirst = (message: string): SubmitFunction => ({ cancel }) => {
		if (!confirm(message)) cancel();
	};
</script>

<svelte:head><title>Moderate · Club Predictions</title></svelte:head>

<div class="head">
	<h1>Moderation</h1>
	<button type="button" class="go" onclick={() => goto('/markets/new')}>New market</button>
</div>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.done}<p class="ok" role="status">{form.done}</p>{/if}

<section>
	<h2>Markets to approve ({data.pending.length})</h2>
	{#if data.pending.length === 0}<p class="meta">Nothing waiting.</p>{/if}
	{#each data.pending as m (m.id)}
		<article class="card">
			<h3>{m.question}</h3>
			<p class="meta">Proposed by {m.creator ?? 'someone'} · {m.closeAt ? `closes ${when(m.closeAt)}` : 'no set close date'} · subsidy {coins(m.subsidy)} · {m.outcomes.join(', ')}</p>
			<p>{m.criteria}</p>
			<div class="row">
				<form method="POST" action="?/approve" use:enhance>
					<input type="hidden" name="marketId" value={m.id} />
					{#if data.sources.length}
						<select name="resolverSource" aria-label="Resolves">
							<option value="">Resolved by moderators</option>
							{#each data.sources as s (s.key)}<option value={s.key}>From {s.label}</option>{/each}
						</select>
						<select name="resolutionMode" aria-label="How the source's answer is used">
							<option value="auto_confirm">A moderator confirms its answer</option>
							{#if data.isAdmin}<option value="auto">Final at once (admins only)</option>{/if}
						</select>
					{/if}
					<button class="go">Approve</button>
				</form>
				<form method="POST" action="?/reject" use:enhance>
					<input type="hidden" name="marketId" value={m.id} />
					<input name="reason" placeholder="Reason (optional)" aria-label="Reason" />
					<button class="quiet">Reject</button>
				</form>
			</div>
			<a href="/markets/{m.id}" class="meta">Open market</a>
		</article>
	{/each}
</section>

<section>
	<h2>Resolutions to decide ({data.proposals.length})</h2>
	{#if data.proposals.length === 0}<p class="meta">Nothing waiting.</p>{/if}
	{#each data.proposals as p (p.id)}
		<article class="card">
			<h3>{p.question}</h3>
			<p>Winner: <strong>{p.outcome}</strong>, proposed by {p.proposer}, {when(p.createdAt)}</p>
			<p class="evidence">Evidence: {p.evidence}</p>
			{#if p.proofs.length}
				<ul class="proofs">
					{#each p.proofs as pf (pf.id)}
						<li>
							{#if pf.kind === 'link'}<a href={pf.url} rel="noopener noreferrer nofollow" target="_blank">{pf.label}</a>
							{:else if pf.kind === 'image'}<a href="/proofs/{pf.id}" target="_blank"><img src="/proofs/{pf.id}" alt={pf.label} loading="lazy" /></a>
							{:else}<a href="/proofs/{pf.id}" target="_blank" rel="noopener">{pf.label}</a>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<div class="row">
				<form method="POST" action="?/accept" use:enhance={confirmFirst('Accept this result? Winners are paid now, and the market can be disputed for 24 hours.')}>
					<input type="hidden" name="proposalId" value={p.id} />
					<button class="go">Accept and pay</button>
				</form>
				<form method="POST" action="?/rejectProposal" use:enhance>
					<input type="hidden" name="proposalId" value={p.id} />
					<button class="quiet">Reject</button>
				</form>
			</div>
			<a href="/markets/{p.marketId}" class="meta">Open market</a>
		</article>
	{/each}
</section>

<section>
	<h2>Overdue: closed, not resolved after a day ({data.overdue.length})</h2>
	{#if data.overdue.length === 0}<p class="meta">Nothing overdue.</p>{/if}
	{#each data.overdue as o (o.id)}
		<div class="live"><a href="/markets/{o.id}">{o.question}</a> <span class="meta">closed {o.closeAt ? when(o.closeAt) : ''}</span></div>
	{/each}
</section>

<section>
	<h2>Disputes in the window ({data.disputes.length})</h2>
	{#if data.disputes.length === 0}<p class="meta">No result can be changed right now.</p>{/if}
	{#each data.disputes as d (d.id)}
		<article class="card">
			<h3>{d.question}</h3>
			<p>Currently <strong>{d.current}</strong>. Window closes {when(d.until)}. Open disputes: {d.disputes}.</p>
			<form method="POST" action="?/reResolve" use:enhance={confirmFirst('Change the result? Every payout is reversed and paid again.')} class="report">
				<input type="hidden" name="marketId" value={d.id} />
				<label class="field">
					Correct winner
					<select name="outcomeId" required>
						{#each d.outcomes as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
					</select>
				</label>
				<input name="evidence" placeholder="Evidence: a link, or a sentence" aria-label="Evidence" required />
				<button class="go">Change result</button>
				{#if form?.error && form.marketId === d.id}<p class="error" role="alert">{form.error}</p>{/if}
			</form>
		</article>
	{/each}
</section>

<section>
	<h2>Reports ({data.reports.length})</h2>
	{#if data.reports.length === 0}<p class="meta">No open reports.</p>{/if}
	{#each data.reports as r (r.id)}
		<article class="card">
			<h3>
				{#if r.kind === 'profile'}Profile of {r.subject}{:else if r.market}{r.kind === 'resolution' ? 'Result of' : 'Market'}: {r.market.question}{/if}
			</h3>
			<p class="meta">Reported by {r.reporter} · {r.kind} · {when(r.createdAt)}</p>
			<p class="evidence">{r.body}</p>
			<form method="POST" action="?/report" use:enhance class="report">
				<input type="hidden" name="reportId" value={r.id} />
				<input name="note" placeholder="What was done, or why not" aria-label="Note" />
				<div class="row">
					<button class="go" name="outcome" value="upheld">Uphold</button>
					<button class="quiet" name="outcome" value="dismissed">Dismiss</button>
				</div>
			</form>
			{#if r.market}<a href="/markets/{r.market.id}" class="meta">Open market</a>{/if}
		</article>
	{/each}
</section>

<section>
	<h2>Live markets</h2>
	{#if data.live.length === 0}<p class="meta">No open markets.</p>{/if}
	{#each data.live as m (m.id)}
		<div class="live">
			<a href="/markets/{m.id}">{m.question}</a>
			<span class="meta">{m.locked ? 'locked until resolved' : m.status}{#if m.lockAt && !m.locked} · locks {when(m.lockAt)}{/if}</span>
			<div class="lock-row">
				{#if m.status === 'open'}
					{#if !m.locked}
						<form method="POST" action="?/lock" use:enhance>
							<input type="hidden" name="marketId" value={m.id} />
							<button class="quiet">Lock trading now</button>
						</form>
						<form method="POST" action="?/scheduleLock" use:enhance class="schedule">
							<input type="hidden" name="marketId" value={m.id} />
							<input type="datetime-local" aria-label="Lock trading at" onchange={localToIso} />
							<input type="hidden" name="lockAt" />
							<button class="quiet">{m.lockAt ? 'Change lock time' : 'Lock at time'}</button>
						</form>
					{/if}
				{/if}
				{#if m.resolverSource}
					<form method="POST" action="?/testSource" use:enhance>
						<input type="hidden" name="marketId" value={m.id} />
						<button class="quiet">Test source now</button>
					</form>
				{#if form?.testResult && form.marketId === m.id}<p class="meta">{form.testResult}</p>{/if}
				{/if}
				<form method="POST" action="?/cancel" use:enhance={confirmFirst('Cancel this market? Every member gets back what they paid in, and it cannot be undone.')} class="cancel-form">
					<input type="hidden" name="marketId" value={m.id} />
					<input name="reason" maxlength="300" placeholder="Reason for members (optional)" aria-label="Reason for cancelling" />
					<button class="quiet danger">Cancel market</button>
				</form>
			</div>
		</div>
	{/each}
</section>

<style>
	section {
		margin-bottom: 24px;
	}
	h2 {
		font-size: 1.125rem;
		margin: 0 0 12px;
	}
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		margin-bottom: 12px;
		display: grid;
		gap: 8px;
	}
	.card h3 {
		margin: 0;
		font-size: 1rem;
	}
	.card p {
		margin: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.evidence {
		overflow-wrap: anywhere;
	}
	.field {
		display: grid;
		gap: 4px;
		font-size: 0.875rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.row form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	input {
		font: inherit;
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
	}
	button {
		font: inherit;
		min-height: 44px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--radius-pill);
		cursor: pointer;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}
	.head h1 {
		margin: 0;
	}
	.go {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
	}
	.quiet {
		background: var(--card-2);
		color: var(--fg);
	}
	.danger {
		color: var(--no-text);
	}
	.live {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
	.live a {
		color: inherit;
		flex: 1;
	}
	.live form {
		margin: 0;
	}
	.lock-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.schedule {
		display: flex;
		gap: 8px;
	}
	.error {
		color: var(--no-text);
	}
	.ok {
		color: var(--yes-text);
	}
</style>
