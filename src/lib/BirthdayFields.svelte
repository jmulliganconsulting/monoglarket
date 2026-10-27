<script lang="ts">
	// Birthday fields with the rewards box (vault "Birthday"). Month and day are saved only if the box is ticked.
	// Also used when the birth year needs month and day for the 18+ check: then they are asked but not kept.
	let { month, day, checked }: { month?: number | string | null; day?: number | string | null; checked?: boolean } = $props();
	// Dropdowns, so browsers can autofill and a month/day pair is always a real choice. The server checks the date against the birth year.
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
</script>

<fieldset class="birthday">
	<legend>Birthday <span class="opt">(optional, for extra rewards)</span></legend>
	<div class="row">
		<label>Month
			<select name="birthMonth" autocomplete="bday-month">
				<option value="">Month</option>
				{#each MONTHS as name, i}<option value={i + 1} selected={String(month) === String(i + 1)}>{name}</option>{/each}
			</select>
		</label>
		<label>Day
			<select name="birthDay" autocomplete="bday-day">
				<option value="">Day</option>
				{#each DAYS as n}<option value={n} selected={String(day) === String(n)}>{n}</option>{/each}
			</select>
		</label>
	</div>
	<label class="check"><input type="checkbox" name="birthdayRewards" checked={!!checked} /> I would like to receive extra rewards on this day.</label>
	<p class="disclaimer">We save your birthday only if you tick that box. A birthday can't be changed once saved, so it can't be used to claim a reward twice. You can remove it later, but you can't add it back.</p>
</fieldset>

<style>
	.birthday {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}
	legend {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		padding: 0;
		margin-bottom: 6px;
	}
	.opt {
		color: var(--muted);
		font-weight: var(--weight);
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
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: var(--weight);
		min-height: 44px;
	}
	.disclaimer {
		color: var(--fg-2);
		font-size: 0.8125rem;
		margin: 0;
	}
</style>
