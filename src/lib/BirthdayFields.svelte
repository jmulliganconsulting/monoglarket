<script lang="ts">
	// Birthday fields with the rewards box (vault "Birthday"). Month and day are saved only if the box is ticked.
	// Also used when the birth year needs month and day for the 18+ check: then they are asked but not kept.
	let { month, day, checked, year = $bindable(null) }: { month?: number | string | null; day?: number | string | null; checked?: boolean; year?: number | string | null } = $props();
	// Dropdowns, so browsers can autofill and a month/day pair is always a real choice. The server checks the date against the birth year.
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	// The selects start from the saved values; after that the user's pick is kept.
	// svelte-ignore state_referenced_locally
	let m = $state<number | string | null>(month ? Number(month) : null);
	// svelte-ignore state_referenced_locally
	let d = $state<number | string | null>(day ? Number(day) : null);
	const mon = $derived(Number(m));
	// The year is optional here. Without a valid one, 29 February stays on offer.
	const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
	const yr = $derived(Number(year));
	const knownYear = $derived(Number.isInteger(yr) && yr >= 1900 ? yr : null);
	const daysInMonth = $derived(mon === 2 ? (knownYear !== null && !leap(knownYear) ? 28 : 29) : [4, 6, 9, 11].includes(mon) ? 30 : 31);
	const DAYS = $derived(Array.from({ length: daysInMonth }, (_, i) => i + 1));
	// A day picked for a month or year that no longer has it is cleared.
	$effect(() => {
		if (Number(d) > daysInMonth) d = null;
	});
</script>

<fieldset class="m-0 grid gap-3 border-0 p-0">
	<legend class="mb-1.5 p-0 text-sm font-strong">Birthday <span class="font-body text-muted">(optional, for extra rewards)</span></legend>
	<div class="grid grid-cols-2 gap-3">
		<label class="grid gap-1.5 text-sm font-strong">Month
			<select class="min-h-11 rounded-xl border border-border bg-card px-3 py-2 font-body text-fg font-[inherit] [font-size:inherit]" name="birthMonth" autocomplete="bday-month" bind:value={m}>
				<option value="">Month</option>
				{#each MONTHS as name, i}<option value={i + 1}>{name}</option>{/each}
			</select>
		</label>
		<label class="grid gap-1.5 text-sm font-strong">Day
			<select class="min-h-11 rounded-xl border border-border bg-card px-3 py-2 font-body text-fg font-[inherit] [font-size:inherit]" name="birthDay" autocomplete="bday-day" bind:value={d}>
				<option value="">Day</option>
				{#each DAYS as n}<option value={n}>{n}</option>{/each}
			</select>
		</label>
	</div>
	<label class="flex min-h-11 items-center gap-2.5 text-sm font-body"><input type="checkbox" name="birthdayRewards" checked={!!checked} /> I would like to receive extra rewards on this day.</label>
	<p class="m-0 text-[0.8125rem] text-fg-2">We save your birthday only if you tick that box. A birthday can't be changed once saved, so it can't be used to claim a reward twice. You can remove it later, but you can't add it back.</p>
</fieldset>
