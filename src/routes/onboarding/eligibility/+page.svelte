<script lang="ts">
	import BirthdayFields from '#lib/BirthdayFields.svelte';
	import { COUNTRIES, CA_PROVINCES, US_STATES } from '#lib/regions.ts';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const v = $derived((form as ActionData | undefined)?.values);
	// Shared with the birthday fields, so the day list follows the year (29 February).
	let birthYear = $state<number | string | null>(null);
	// Picked in the dropdown; until then the last submitted value, or the United States.
	let picked = $state<string | null>(null);
	const country = $derived(picked ?? v?.country ?? 'US');
	const regions = $derived(country === 'US' ? US_STATES : country === 'CA' ? CA_PROVINCES : null);
</script>

<svelte:head><title>Eligibility · Monoglarket</title></svelte:head>

<p class="step">Step 1 of 6</p>
<h1>Before you start</h1>
<p class="lede">We ask for your birth year to check you're 18 or older. We don't store it.</p>

<form method="POST">
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

	<div class="row">
		<label>Birth year<input name="birthYear" type="number" inputmode="numeric" autocomplete="bday-year" min="1900" max={data.thisYear} required bind:value={birthYear} /></label>
	</div>

	<BirthdayFields month={v?.birthMonth} day={v?.birthDay} checked={v?.birthdayRewards} bind:year={birthYear} />

	<label>Country
		<select name="country" required autocomplete="country" onchange={(e) => (picked = e.currentTarget.value)}>
			{#each COUNTRIES as [code, name]}<option value={code} selected={country === code}>{name}</option>{/each}
		</select>
	</label>
	{#if country === 'OTHER'}
		<label>Country name<input name="countryOther" required maxlength="60" autocomplete="country-name" value={v?.countryOther ?? ''} /></label>
	{/if}
	{#key country}
		{#if regions}
			<label>{country === 'US' ? 'State' : 'Province or territory'}{country === 'US' ? '' : ' (optional)'}
				<select name="state" required={country === 'US'} autocomplete="address-level1">
					<option value="">{country === 'US' ? 'Choose a state' : 'Choose one'}</option>
					{#each regions as [code, name]}<option value={code} selected={v?.state === code}>{name}</option>{/each}
				</select>
			</label>
		{:else}
			<label>State or region <span class="opt">(optional)</span><input name="state" maxlength="60" autocomplete="address-level1" value={v?.state ?? ''} /></label>
		{/if}
	{/key}
	<label>City <span class="opt">(optional)</span><input name="city" maxlength="60" autocomplete="address-level2" value={v?.city ?? ''} /></label>

	<label class="check"><input type="checkbox" name="accepted" required /> I accept the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. No real money, ever.</label>

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
		grid-template-columns: 2fr 1fr 1fr;
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
