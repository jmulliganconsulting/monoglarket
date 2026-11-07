<script lang="ts">
	import { parseRange } from '../../../markets/ranges.ts';
	import { describeWhen, fromInput, parseWhen } from '../../../markets/when.ts';
	import ZoneSelect from '#lib/ZoneSelect.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const f = $derived((form as ActionData | undefined)?.values);
	// Dates and times on this form are read in this zone: the browser's own unless changed.
	// svelte-ignore state_referenced_locally
	let tz = $state(f?.tz ?? '');
	// datetime-local has no zone, so the close time is read in tz and sent as UTC ISO
	const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	let closeLocal = $state(local(new Date(Date.now() + 7 * 86_400_000)));
	// Optional: a market with no set close date trades until a moderator closes or resolves it.
	let noClose = $state(false);
	const closeAt = $derived.by(() => {
		const t = noClose || !tz ? NaN : fromInput(closeLocal, tz);
		return Number.isNaN(t) ? '' : new Date(t).toISOString();
	});

	const kinds = {
		one: { name: 'One winner', blurb: 'Yes/No, or multiple options with only a single winner', lines: 'Outcomes, one per line (2 to 10)', example: 'Yes\nNo' },
		several: { name: 'Several options ', blurb: 'Each option is a Yes/No market. ', lines: 'Options, one per line (2 to 10)', example: 'Pizza\nTacos\nSushi' },
		numeric: { name: 'Numeric', blurb: 'Each option is a yes/no for a numberic range', lines: 'Number or number ranges, one per line (2 to 20)', example: '≤19\n20-29\n30-39\n40+' },
		dates: { name: 'Date', blurb: 'Each option is a date, time or range of them', lines: 'Days or times, one per line (1 to 20)', example: 'Before 11/15\nBefore 11/23\nAfter 11/23' },
	} as const;
	type Kind = keyof typeof kinds;
	// svelte-ignore state_referenced_locally
	let kind = $state<Kind>((f?.kind as Kind) in kinds ? (f?.kind as Kind) : 'one');
	// svelte-ignore state_referenced_locally
	let lines = $state(f?.outcomes ?? kinds.one.example);
	// Switching type swaps in that type's example, unless something of the person's own is already typed.
	const pick = (k: Kind) => {
		if (Object.values(kinds).some((x) => x.example === lines) || !lines.trim()) lines = kinds[k].example;
		kind = k;
	};
	const rows = $derived(lines.split('\n').map((s) => s.trim()).filter(Boolean));
</script>

<svelte:head><title>New market · Monoglarket</title></svelte:head>

<div class="page">
	<h1>Propose a market</h1>
	<p class="lede">A moderator approves it before anyone can trade. Currency: {data.currency}.</p>

	<form method="POST">
		<fieldset class="kinds">
			<legend>What are people predicting?</legend>
			{#each Object.entries(kinds) as [k, v] (k)}
				<label class="kind" class:on={kind === k}>
					<input type="radio" name="kind" value={k} checked={kind === k} onchange={() => pick(k as Kind)} />
					<strong>{v.name}</strong>
					<span>{v.blurb}</span>
				</label>
			{/each}
		</fieldset>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

		<label>
			Question
			<input name="question" required maxlength="200" value={f?.question ?? ''} placeholder={kind === 'numeric' ? 'How many people check in at the next general meeting?' : 'Will the robotics team win regionals?'} />
		</label>

		<label>
			How it resolves
			<textarea name="criteria" required rows="3" maxlength="1000" placeholder="What counts, and the source that decides it">{f?.criteria ?? ''}</textarea>
		</label>

		<div class="lines">
			<label>
				{kinds[kind].lines}
				<textarea name="outcomes" required rows="5" bind:value={lines}></textarea>
			</label>
			{#if kind === 'numeric'}
				<p class="hint">Write ranges like 20-29, 40+, ≤19, Above 4.60 or Under 10. They may overlap: each one wins if it holds the final number.</p>
				<ul class="preview" aria-label="How each range reads">
					{#each rows as r, i (i)}
						<li class:bad={!parseRange(r)}>{r}{#if !parseRange(r)}<span class="sr-only"> (not a range)</span>{/if}</li>
					{/each}
				</ul>
			{:else if kind === 'dates'}
				<p class="hint">Write days like 11/2, Before 11/15, After 11/23 or 11/15-11/20, or times like Before 3pm, Sunday at 3pm or Sat 9am-5pm. A time on its own means "by then". A day with no year is the next one to come, and a time with no day is today. Each wins if it holds when it happened. Days run midnight to midnight in the time zone below.</p>
				<ul class="preview" aria-label="How each option reads">
					{#each rows as r, i (i)}
						{@const when = tz ? parseWhen(r, tz) : null}
						<li class:bad={!when}>{when ? describeWhen(when, tz) : r}{#if !when}<span class="sr-only"> (not a day or time)</span>{/if}</li>
					{/each}
				</ul>
			{/if}
		</div>

		<ZoneSelect bind:value={tz} />

		<label>
			Trading ends
			<input type="datetime-local" bind:value={closeLocal} required={!noClose} disabled={noClose} />
			<input type="hidden" name="closeAt" value={closeAt} />
			<span class="hint">No more buying or selling after this. The market then waits for a moderator to resolve it. Set it to just before the result could be known.</span>
		</label>
		<label class="check"><input type="checkbox" bind:checked={noClose} /> No end time (trading runs until a moderator resolves it)</label>

		<label>
			Category
			{#if !data.categories.length}<span class="hint">No categories yet. An admin adds them on the Admin page.</span>{/if}
			<select name="categoryId">
				<option value="">None</option>
				{#each data.categories as c (c.id)}<option value={c.id} selected={String(c.id) === f?.categoryId}>{c.name}</option>{/each}
			</select>
		</label>

		<div class="pair">
			<label>
				Starting subsidy <span class="opt">{kind === 'one' ? data.currency : `${data.currency} per option`}</span>
				<input name="subsidy" type="number" inputmode="numeric" min="1" step="1" required value={f?.subsidy ?? '100'} />
			</label>
			<label>
				Spend cap per member <span class="opt">blank for 500</span>
				<input name="spendCap" type="number" inputmode="numeric" min="1" step="1" value={f?.spendCap ?? ''} />
			</label>
		</div>

		<div class="pair">
			<label class="colour">Primary colour <input type="color" name="colorPrimary" value="#4c8bf5" /></label>
			<label class="colour">Secondary colour <input type="color" name="colorSecondary" value="#e8844c" /></label>
		</div>

		<button class="go">Propose market</button>
	</form>
</div>

<style>
	.page {
		max-width: 640px;
	}
	.lede {
		color: var(--muted);
		margin: 0 0 24px;
	}
	form {
		display: grid;
		gap: 20px;
	}
	label {
		display: grid;
		gap: 6px;
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
	}
	.opt,
	.hint {
		color: var(--muted);
		font-weight: var(--weight);
	}
	.hint {
		margin: 0;
		font-size: 0.8125rem;
	}
	input,
	select,
	textarea {
		font: inherit;
		font-weight: var(--weight);
		min-height: 44px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 8px 12px;
		background: var(--card);
		color: var(--fg);
	}
	textarea {
		min-height: 0;
	}
	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible,
	.kind:has(input:focus-visible) {
		outline: 2px solid var(--brand-text);
		outline-offset: 1px;
	}
	.kinds {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.kinds legend {
		font-weight: var(--weight-strong);
		font-size: 0.875rem;
		margin-bottom: 8px;
	}
	.kind {
		gap: 2px;
		padding: 12px 14px;
		border-radius: 14px;
		background: var(--card);
		box-shadow: 0 0 0 1px var(--border);
		cursor: pointer;
	}
	.kind input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.kind strong {
		font-size: 0.9375rem;
	}
	.kind span {
		color: var(--muted);
		font-weight: var(--weight);
		font-size: 0.8125rem;
		line-height: 1.35;
	}
	.kind.on {
		box-shadow: 0 0 0 2px var(--fg);
	}
	.lines {
		display: grid;
		gap: 8px;
	}
	.preview {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.preview li {
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--card-2);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
	.preview li.bad {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--no);
		color: var(--no-text);
		text-decoration: line-through;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: var(--weight);
		margin-top: -8px;
	}
	.check input {
		min-height: 0;
	}
	.colour input {
		padding: 4px;
		width: 100%;
	}
	.go {
		font: inherit;
		min-height: 48px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: #fff;
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
		margin: 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	@media (max-width: 520px) {
		.kinds,
		.pair {
			grid-template-columns: 1fr;
		}
	}
</style>
