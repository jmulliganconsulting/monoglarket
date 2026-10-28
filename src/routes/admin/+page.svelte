<script lang="ts">
	import { signedCoins } from '#lib/format.ts';
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	// Stops the submit before it is sent when the admin backs out.
	// One key per attempt: a double submit adds once, and the next change gets a fresh key (vault "Balance adjustments").
	let adjustKey = $state(crypto.randomUUID());
	const adjustSubmit: SubmitFunction = ({ cancel }) => {
		if (!confirm('Change this balance? The change is recorded and cannot be undone from here.')) return cancel();
		return async ({ update }) => {
			await update();
			adjustKey = crypto.randomUUID();
		};
	};
	const confirmFirst = (message: string): SubmitFunction => ({ cancel }) => {
		if (!confirm(message)) cancel();
	};
</script>

<svelte:head><title>Admin · Monoglarket</title></svelte:head>

<h1>Admin</h1>
<p class="meta">Blocks, breaks and resolvers. Moderation is on the <a href="/moderate">moderation page</a>.</p>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{#if form?.done}<p class="ok" role="status">{form.done}</p>{/if}

<section>
	<h2>Blocked emails ({data.blocks.length})</h2>
	{#if data.blocks.length === 0}<p class="meta">No one is blocked.</p>{/if}
	{#each data.blocks as b (b.id)}
		<div class="row">
			<span>{b.email} <span class="meta">{b.reason} · {when(b.createdAt)}</span></span>
			<form method="POST" action="?/liftBlock" use:enhance={confirmFirst('Lift this block? The email can sign in and go through the screens again.')}>
				<input type="hidden" name="blockId" value={b.id} />
				<button class="quiet">Lift block</button>
			</form>
		</div>
	{/each}
</section>

<section>
	<h2>On a break ({data.breaks.length})</h2>
	{#if data.breaks.length === 0}<p class="meta">Nobody is on a break.</p>{/if}
	{#each data.breaks as b (b.id)}
		<div class="row">
			<span>{b.username ? `@${b.username}` : b.displayName} <span class="meta">until {when(b.breakUntil!)}</span></span>
			<form method="POST" action="?/endBreak" use:enhance={confirmFirst('End this break early? Trading opens again straight away.')}>
				<input type="hidden" name="userId" value={b.id} />
				<button class="quiet">End break</button>
			</form>
		</div>
	{/each}
</section>

<section>
	<h2>Adjust a balance</h2>
	<p class="meta">Adds or removes balance. Recorded in the ledger and the audit log. The private reason is for admins only. The public reason, if you give one, is shown to the member in their visit summary.</p>
	<form method="POST" action="?/adjust" use:enhance={adjustSubmit} class="grant">
		<input type="hidden" name="key" value={adjustKey} />
		<label class="field">Member (@username or email)<input name="who" required autocomplete="off" /></label>
		<label class="field">Currency
			<select name="currencyId" required>
				{#each data.currencies as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
		</label>
		<label class="field">Add or remove
			<select name="mode">
				<option value="add">Add</option>
				<option value="remove">Remove</option>
			</select>
		</label>
		<label class="field">Amount (whole number)<input name="amount" type="number" inputmode="numeric" min="1" step="1" required /></label>
		<label class="field">Private reason (admins only, at least 5 characters)<textarea name="reasonPrivate" required minlength="5" maxlength="500" rows="2"></textarea></label>
		<label class="field">Public reason (optional, shown to the member)<input name="reasonPublic" maxlength="280" /></label>
		<button class="go">Make the change</button>
	</form>
	<h3>Recent changes</h3>
	{#each data.adjustments as a (a.id)}
		<div class="row">
			<span>{a.who}: {signedCoins(a.amount)} {a.currency} <span class="meta">by {a.actor}, {when(a.createdAt)}</span><br /><span class="meta">Private: {a.reasonPrivate}</span>{#if a.reasonPublic}<br /><span class="meta">Public: {a.reasonPublic}</span>{/if}</span>
		</div>
	{:else}
		<p class="meta">No changes yet.</p>
	{/each}
</section>

<section>
	<h2>Groups and visibility</h2>
	<p class="meta">A market can be limited to one group. Members of that group see it; everyone else doesn't. Set this on the market's edit page.</p>
	<form method="POST" action="?/createGroup" use:enhance class="grant">
		<label class="field">New group name<input name="name" required maxlength="60" /></label>
		<button class="go">Create group</button>
	</form>
	{#each data.groups as g (g.id)}
		<div class="row">
			<span><strong>{g.name}</strong>: {g.members.map((m) => m.name).join(', ') || 'no members yet'}</span>
		</div>
		<form method="POST" action="?/addToGroup" use:enhance class="inline">
			<input type="hidden" name="groupId" value={g.id} />
			<input name="who" required placeholder="@username or email" aria-label="Add to {g.name}" />
			<button class="quiet">Add to {g.name}</button>
		</form>
		{#each g.members as m (m.id)}
			<form method="POST" action="?/removeFromGroup" use:enhance class="inline">
				<input type="hidden" name="groupId" value={g.id} />
				<input type="hidden" name="userId" value={m.id} />
				<span class="meta">{m.name}</span> <button class="quiet small">Remove</button>
			</form>
		{/each}
	{/each}
</section>

<section>
	<h2>Resolved markets on the home page</h2>
	<p class="meta">Resolved markets stay on the home page for this many hours, then move to the history page. Automated markets leave as soon as they resolve.</p>
	<form method="POST" action="?/setDecidedHours" use:enhance class="grant">
		<label class="field">Hours<input name="hours" type="number" min="0" max="8760" step="1" value={data.decidedHours} required /></label>
		<button class="quiet">Save</button>
	</form>
</section>

<section>
	<h2>Seasons and allowance</h2>
	<p class="meta">A season starts the profit count on the leaderboard. The weekly allowance is paid to every member each Monday (UTC), in the currency you pick. 0 switches it off.</p>
	<form method="POST" action="?/addSeason" class="grant">
		<label class="field">New season name<input name="name" required maxlength="60" placeholder="Autumn 2026" /></label>
		<label class="field">Starts at (blank for now)<input name="startsAt" type="datetime-local" /></label>
		<button class="go">Start season</button>
	</form>
	<p class="meta">Recent: {data.seasons.map((s) => s.name).join(' · ') || 'none yet'}</p>
	<form method="POST" action="?/setAllowance" class="grant">
		<label class="field">Currency
			<select name="currencyId">
				{#each data.allowances as c (c.id)}<option value={c.id}>{c.code}</option>{/each}
			</select>
		</label>
		<label class="field">Weekly allowance (whole number)<input name="amount" type="number" min="0" max="100000" step="1" required /></label>
		<button class="quiet">Save allowance</button>
	</form>
</section>

<section>
	<h2>Categories</h2>
	<p class="meta">Members browse markets by these. Moderators pick one per market.</p>
	<p class="meta">{data.categories.map((c) => c.name).join(' · ') || 'None yet.'}</p>
	{#if data.categories.length}
		<form method="POST" action="?/setCategoryOrder" use:enhance class="grant">
			<p class="meta">Order of the tabs on the home page: the lowest number comes first.</p>
			{#each data.categories as c (c.id)}
				<label class="field">
					{c.name}
					<input name="sort-{c.id}" type="number" step="1" required value={c.sort} />
				</label>
			{/each}
			<button class="quiet">Save order</button>
		</form>
		<form method="POST" action="?/setCategoryColours" use:enhance class="grant">
			<p class="meta">Tab colour: #rrggbb, or empty for the default.</p>
			{#each data.categories as c (c.id)}
				<label class="field">
					{c.name}
					<input name="colour-{c.id}" pattern={'#[0-9a-fA-F]{6}'} placeholder="#rrggbb" value={c.color ?? ''} />
				</label>
			{/each}
			<button class="quiet">Save colours</button>
		</form>
	{/if}
	<form method="POST" action="?/addCategory" use:enhance class="grant">
		<label class="field">
			New category
			<input name="name" required maxlength="40" />
		</label>
		<button class="go">Add category</button>
	</form>
</section>

<section>
	<h2>Resolvers</h2>
	<p class="meta">A member you trust with one market resolves it alone, at once. They don't get the rest of this page.</p>
	<form method="POST" action="?/grant" use:enhance class="grant">
		<label class="field">
			Market
			<select name="marketId" required>
				{#each data.markets as m (m.id)}<option value={m.id}>{m.question} ({m.status})</option>{/each}
			</select>
		</label>
		<label class="field">
			Their @username or email
			<input name="who" required autocomplete="off" />
		</label>
		<button class="go">Grant</button>
	</form>
	{#each data.grants as g (g.id)}
		<div class="row">
			<span>{g.who} on <a href="/markets/{g.marketId}">{g.question}</a> <span class="meta">{g.status}</span></span>
			<form method="POST" action="?/revoke" use:enhance={confirmFirst('Take this resolver grant back?')}>
				<input type="hidden" name="grantId" value={g.id} />
				<button class="quiet">Revoke</button>
			</form>
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
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
	.row a {
		color: inherit;
	}
	.grant {
		display: grid;
		gap: 12px;
		margin: 12px 0;
	}
	.field {
		display: grid;
		gap: 4px;
	}
	input,
	select {
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
	.go {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		justify-self: start;
	}
	.quiet {
		background: var(--card-2);
		color: var(--fg);
	}
	.error {
		color: var(--no-text);
	}
	.ok {
		color: var(--yes-text);
	}
	form {
		margin: 0;
	}
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.small {
		min-height: 36px;
	}
</style>
