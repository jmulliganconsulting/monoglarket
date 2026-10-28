<script lang="ts">
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const v = $derived((form as ActionData | undefined)?.values);
	const prefix = $derived(v?.prefix ?? '');
</script>

<svelte:head><title>Your name · MonoGlarket</title></svelte:head>

<p class="step">Step 2 of 6</p>
<h1>Your name</h1>
<p class="lede">Other members see your preferred name and @username. Your legal name stays private.</p>

<form method="POST">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

	<div class="row">
		<label>Prefix <span class="opt">(optional)</span>
			<select name="prefix">
				{#each ['', 'Mr', 'Ms', 'Mrs', 'Mx', 'Dr', 'Prof'] as p (p)}
					<option value={p} selected={prefix === p}>{p || 'None'}</option>
				{/each}
			</select>
		</label>
		<label>First name<input name="firstName" required maxlength="50" value={v?.firstName ?? data.prefill.firstName} /></label>
		<label>Middle <span class="opt">(optional)</span><input name="middleName" maxlength="50" value={v?.middleName ?? ''} /></label>
		<label>Last name<input name="lastName" required maxlength="50" value={v?.lastName ?? data.prefill.lastName} /></label>
		<label>Suffix <span class="opt">(optional)</span><input name="suffix" maxlength="10" placeholder="Jr, III, PhD" value={v?.suffix ?? ''} /></label>
	</div>

	<label>Preferred name <span class="opt">(leave blank to use first and last)</span><input name="preferredName" maxlength="60" value={v?.preferredName ?? ''} /></label>
	<label>@username <span class="opt">3 to 20 letters, numbers or _</span><input name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{'{3,20}'}" value={v?.username ?? data.prefill.username} /></label>
	<label>Pronouns <span class="opt">(optional)</span><input name="pronouns" maxlength="40" placeholder="she/her, they/them, or your own" value={v?.pronouns ?? ''} /></label>
	<label class="check"><input type="checkbox" name="pronounsPublic" /> Show my pronouns to other members</label>

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
	input:not([type='checkbox']),
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
