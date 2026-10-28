<script lang="ts">
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const v = $derived((form as ActionData | undefined)?.values);
	let picked = $state('');
	let search = $state('');
	// After a failed save the form comes back with the values it was sent, so show those until the member picks again.
	const status = $derived(picked || v?.status || '');
	const current = $derived(status === 'current');
	const term = (t: string) => t.toLowerCase().includes(search.trim().toLowerCase());
	const levels = [
		['incoming', 'Incoming'],
		['first', 'First year'],
		['second', 'Second year'],
		['third', 'Third year'],
		['fourth', 'Fourth year'],
		['fifth', 'Fifth year'],
		['bs_ms', 'BS/MS'],
		['masters', "Master's"],
		['phd', 'PhD'],
	];
</script>

<svelte:head><title>School · MonoGlarket</title></svelte:head>

<p class="step">Step 3 of 6</p>
<h1>Your school</h1>
<p class="lede">Used for sitecurrency checks and for aggregate questions. Nothing here is shown to other members by name.</p>

<form method="POST">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

	<fieldset>
		<legend>I am a</legend>
		{#each [['current', 'Current student'], ['alum', 'Alum'], ['faculty', 'Faculty or staff'], ['none', 'None of these']] as [key, label] (key)}
			<label class="check"><input type="radio" name="status" value={key} checked={status === key} onchange={() => (picked = key)} required /> {label}</label>
		{/each}
	</fieldset>

	{#if current}
		<label>Level
			<select name="seniority" required>
				<option value="">Choose</option>
				{#each levels as [key, label] (key)}
					<option value={key} selected={v?.seniority === key}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="check"><input type="checkbox" name="onCoopTerm" /> I am on co-op this term</label>
		<label class="check"><input type="checkbox" name="isTransfer" /> I transferred to RIT</label>
	{/if}

	<fieldset class="majors">
		<legend>{current ? 'Majors (pick at least one)' : 'Majors (optional)'}</legend>
		<input type="search" placeholder="Search, e.g. math" aria-label="Search majors" bind:value={search} />
		<div class="list">
			{#each data.programs as p (p.key)}
				<label class="check" hidden={!term(p.label)}><input type="checkbox" name="programs" value={p.key} /> {p.label}</label>
			{/each}
		</div>
	</fieldset>

	<div class="row">
		<label>Graduation term <span class="opt">(optional)</span>
			<select name="graduationTerm">
				<option value="">Not set</option>
				{#each ['SPRING', 'SUMMER', 'FALL'] as t (t)}
					<option value={t} selected={data.prefill.graduationTerm === t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
				{/each}
			</select>
		</label>
		<label>Graduation year <span class="opt">(optional)</span><input name="graduationYear" type="number" inputmode="numeric" min="1950" max="2100" value={data.prefill.graduationYear} /></label>
	</div>

	<button class="go">Continue</button>
</form>

<style>
	.step {
		color: var(--muted);
		font-size: 0.875rem;
		margin: 0;
	}
	.lede {
		color: var(--fg-2);
		margin: 0 0 16px;
	}
	form {
		display: grid;
		gap: 16px;
		max-width: 560px;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 6px;
	}
	legend {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		margin-bottom: 6px;
	}
	.list {
		max-height: 320px;
		overflow: auto;
		display: grid;
		gap: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 4px 12px;
		background: var(--card);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	label {
		display: grid;
		gap: 6px;
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
	}
	.check[hidden] {
		display: none;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: var(--weight);
		min-height: 44px;
	}
	.opt {
		color: var(--muted);
		font-weight: var(--weight);
	}
	input:not([type='checkbox']):not([type='radio']),
	select {
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
		font: inherit;
		min-height: 44px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
		margin: 0;
	}
</style>
