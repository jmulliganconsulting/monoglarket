<script lang="ts">
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const f = $derived((form as ActionData | undefined)?.values);
	// datetime-local has no zone, so send the browser's local time as UTC ISO
	const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	let closeLocal = $state(local(new Date(Date.now() + 7 * 86_400_000)));
	// Optional: a market with no set close date trades until a moderator closes or resolves it.
	let noClose = $state(false);
	const closeAt = $derived(!noClose && closeLocal && !Number.isNaN(Date.parse(closeLocal)) ? new Date(closeLocal).toISOString() : '');
	// Optional: trading locks at this time and stays locked until it is resolved.
	let lockLocal = $state('');
	const lockAt = $derived(lockLocal && !Number.isNaN(Date.parse(lockLocal)) ? new Date(lockLocal).toISOString() : '');
</script>

<svelte:head><title>New market · Club Predictions</title></svelte:head>

<h1>Propose a market</h1>
<p class="lede">A moderator approves it before anyone can trade. Currency: {data.currency}.</p>

<form method="POST">
	<fieldset class="kind">
			<legend>How many can win?</legend>
			<label class="choice"><input type="radio" name="kind" value="one" checked={f?.kind !== 'several' && f?.kind !== 'dates' && f?.kind !== 'people'} /> One winner (multiple choice)</label>
			<label class="choice"><input type="radio" name="kind" value="people" checked={f?.kind === 'people'} /> One winner, and each option is an SSE member (their name and picture show on it)</label>
			<label class="choice"><input type="radio" name="kind" value="several" checked={f?.kind === 'several'} /> Several can win (each option is its own yes/no market)</label>
			<label class="choice"><input type="radio" name="kind" value="dates" checked={f?.kind === 'dates'} /> A date (each line is a day, like 2027-06-01. Each day gets an "on or before this day" option, settled when you enter when it happened)</label>
		</fieldset>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

	<label>
		Question
		<input name="question" required maxlength="200" value={f?.question ?? ''} placeholder="Will the robotics team win regionals?" />
	</label>

	<label>
		How it resolves
		<textarea name="criteria" required rows="3" maxlength="1000" placeholder="What counts, and the source that decides it">{f?.criteria ?? ''}</textarea>
	</label>

	<label>
		Outcomes, one per line (2 to 10). For several winners, each line is one option. For a date, each line is a day (YYYY-MM-DD). For members, each line is their RIT email.
		<textarea name="outcomes" required rows="4" placeholder="Yes&#10;No">{f?.outcomes ?? 'Yes\nNo'}</textarea>
	</label>

	<label>
		Closes at
		<input type="datetime-local" bind:value={closeLocal} required={!noClose} disabled={noClose} />
		<input type="hidden" name="closeAt" value={closeAt} />
		<span class="choice"><input type="checkbox" bind:checked={noClose} /> No set close date (trading stays open until a moderator closes it)</span>
	</label>

	<label>
		Category
		{#if !data.categories.length}<span class="meta">No categories yet. An admin adds them on the Admin page.</span>{/if}
		<select name="categoryId">
			<option value="">None</option>
			{#each data.categories as c (c.id)}<option value={c.id} selected={String(c.id) === f?.categoryId}>{c.name}</option>{/each}
		</select>
	</label>

	<label>
		Lock trading at (optional, stays locked until resolved)
		<input type="datetime-local" bind:value={lockLocal} />
		<input type="hidden" name="lockAt" value={lockAt} />
	</label>

	<div class="colours">
		<label>Primary colour <input type="color" name="colorPrimary" value="#4c8bf5" /></label>
		<label>Secondary colour <input type="color" name="colorSecondary" value="#e8844c" /></label>
	</div>

	<label>
		Starting subsidy ({data.currency}, per option for several winners)
		<input name="subsidy" type="number" inputmode="numeric" min="1" step="1" required value={f?.subsidy ?? '100'} />
	</label>

	<label>
		Spend cap per member ({data.currency}, blank for 500)
		<input name="spendCap" type="number" inputmode="numeric" min="1" step="1" value={f?.spendCap ?? ''} />
	</label>

	<button>Propose market</button>
</form>

<style>
	.lede {
		color: var(--muted);
		margin: 0 0 16px;
	}
	form {
		display: grid;
		gap: 16px;
		max-width: 560px;
	}
	label {
		display: grid;
		gap: 6px;
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
	}
	input,
	textarea,
	button {
		font: inherit;
		font-weight: var(--weight);
		min-height: 44px;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 8px 12px;
		background: var(--card);
		color: var(--fg);
	}
	textarea {
		min-height: 0;
	}
	.kind {
		display: grid;
		gap: 8px;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.kind legend {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		margin-bottom: 6px;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: var(--weight);
	}
	button {
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
		margin: 0;
		font-weight: var(--weight);
	}
</style>
