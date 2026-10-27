<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const act = $derived(form as ActionData | undefined);
	// datetime-local has no zone: the hidden field carries the browser's local time as ISO, as on the new-market form.
	const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	// svelte-ignore state_referenced_locally
	// svelte-ignore state_referenced_locally
	let noClose = $state(data.market.closeAt === null);
	// svelte-ignore state_referenced_locally
	let closeLocal = $state(local(new Date(data.market.closeAt ?? Date.now() + 7 * 86_400_000)));
	const closeAt = $derived(!noClose && closeLocal && !Number.isNaN(Date.parse(closeLocal)) ? new Date(closeLocal).toISOString() : '');
	let removeReason = $state('');
	const confirmFirst = (message: string): SubmitFunction => ({ cancel }) => {
		if (!confirm(message)) cancel();
	};
	const groupName = (id: number | null) => data.groups.find((g) => g.id === id)?.name ?? '';
</script>

<svelte:head><title>Edit · {data.market.question} · Club Predictions</title></svelte:head>

<h1>Edit market</h1>
<p class="meta"><a href="/markets/{data.market.id}">Back to the market</a></p>
{#if act && 'error' in act && act.error}<p class="error" role="alert">{act.error}</p>{/if}
{#if act && 'done' in act && act.done}<p class="ok" role="status">{act.done}</p>{/if}

{#if data.isAdmin}
	<section class="card">
		<h2>Words and times</h2>
		<form method="POST" action="?/details" use:enhance class="stack">
			<label class="field">Question<input name="question" required maxlength="200" value={data.market.question} /></label>
			<label class="field">How it resolves<textarea name="criteria" required rows="3" maxlength="1000">{data.market.criteria}</textarea></label>
			<label class="field">Closes at<input type="datetime-local" bind:value={closeLocal} required /></label>
			<input type="hidden" name="closeAt" value={closeAt} />
			<label class="choice"><input type="checkbox" bind:checked={noClose} /> No set close date</label>
			<label class="field">Category
				<select name="categoryId">
					<option value="">None</option>
					{#each data.categories as c (c.id)}<option value={c.id} selected={c.id === data.market.categoryId}>{c.name}</option>{/each}
				</select>
			</label>
			<button class="go">Save</button>
		</form>
	</section>
{/if}

<section class="card">
	<h2>Options</h2>
	<p class="meta">Adding an option starts it with no shares, so the other prices move to make room. Removing one refunds everyone who bought it, with the reason you give.</p>
	<ul class="plain">
		{#each data.outcomes as o (o.id)}
			<li>
				<span>{o.label}</span>
				<form method="POST" action="?/removeOption" use:enhance={confirmFirst(`Remove “${o.label}”? Everyone who bought it is refunded.`)} class="inline">
					<input type="hidden" name="outcomeId" value={o.id} />
					<input name="reason" required minlength="5" maxlength="500" placeholder="Why it's removed (members see this)" aria-label="Reason for removing {o.label}" bind:value={removeReason} />
					<button class="quiet">Remove</button>
				</form>
			</li>
		{/each}
	</ul>
	{#if data.removed.length}<p class="meta">Removed: {data.removed.map((o) => o.label).join(', ')}</p>{/if}
	<form method="POST" action="?/addOption" use:enhance class="inline">
		<input name="label" required maxlength="80" placeholder="New option" aria-label="New option" />
		<button class="go">Add option</button>
	</form>
</section>

<section class="card">
	<h2>Who can see it</h2>
	<p class="meta">Public: everyone. Hidden: only moderators and admins, and not on any list. Group: members of one group.</p>
	<form method="POST" action="?/visibility" use:enhance class="stack">
		<label class="field">Visibility
			<select name="visibility">
				<option value="public" selected={data.market.visibility === 'public'}>Public</option>
				<option value="hidden" selected={data.market.visibility === 'hidden'}>Hidden</option>
				<option value="group" selected={data.market.visibility === 'group'}>One group</option>
			</select>
		</label>
		<label class="field">Group (for “One group”)
			<select name="groupId">
				<option value="">None</option>
				{#each data.groups as g (g.id)}<option value={g.id} selected={g.id === data.market.groupId}>{g.name}</option>{/each}
			</select>
		</label>
		<button class="quiet">Save visibility</button>
		{#if data.market.groupId}<p class="meta">Current group: {groupName(data.market.groupId)}</p>{/if}
	</form>
</section>

{#if data.isAdmin}
	<section class="card danger-zone">
		<h2>Delete</h2>
		<p class="meta">An open or closed market is cancelled first, so everyone is refunded. The market then disappears everywhere except the admin panel. The ledger keeps every transaction. A resolved market keeps its payouts.</p>
		{#if data.market.deleted}
			<p>Already deleted.</p>
		{:else}
			<form method="POST" action="?/delete" use:enhance={confirmFirst('Delete this market? It disappears for everyone. Open markets are refunded first.')} class="stack">
				<label class="field">Internal reason (admins only)<textarea name="reason" required minlength="5" rows="2"></textarea></label>
				<button class="quiet danger">Delete market</button>
			</form>
		{/if}
	</section>
{/if}

<style>
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		margin-bottom: 12px;
	}
	h2 {
		font-size: 1.125rem;
		margin: 0 0 8px;
	}
	.stack,
	.inline {
		display: grid;
		gap: 10px;
	}
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		margin-top: 8px;
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
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}
	.field {
		display: grid;
		gap: 4px;
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	input,
	select,
	textarea {
		font: inherit;
		min-height: 44px;
		padding: 8px 12px;
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
	.danger {
		color: var(--no-text);
	}
	.error {
		color: var(--no-text);
	}
	.ok {
		color: var(--yes-text);
	}
</style>
