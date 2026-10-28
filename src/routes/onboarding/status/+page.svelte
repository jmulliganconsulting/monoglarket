<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Your status · MonoGlarket</title></svelte:head>

<p class="step">Step 4 of 6</p>
<h1>Your status</h1>
<p class="lede">These come from the club's own records. If something looks wrong, tell an officer; the fix is normally on the SSE site.</p>

{#if data.badges.length}
	<ul class="badges">
		{#each data.badges as b (b)}<li>{b}</li>{/each}
	</ul>
{:else}
	<p class="lede">Guest. Nothing in the club's records yet.</p>
{/if}

<details class="wrong">
	<summary>This looks wrong</summary>
	<form method="POST" action="?/wrong">
		<label class="field">
			Tell an admin what is wrong. The fix is normally on the SSE site.
			<textarea name="body" rows="3" required minlength="5" maxlength="1000"></textarea>
		</label>
		<button class="quiet">Send to an admin</button>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.reported}<p class="ok" role="status">Sent. Thank you. Nothing changes until an admin looks at it.</p>{/if}
	</form>
</details>

<form method="POST" action="?/continue">
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
	.badges {
		list-style: none;
		padding: 0;
		margin: 0 0 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.badges li {
		background: var(--card-2);
		border-radius: var(--radius-pill);
		padding: 6px 14px;
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	.wrong {
		margin-bottom: 24px;
	}
	.wrong summary {
		color: var(--fg-2);
		min-height: 44px;
		display: flex;
		align-items: center;
		cursor: pointer;
	}
	.wrong form {
		display: grid;
		gap: 8px;
	}
	.wrong textarea {
		font: inherit;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
	}
	.wrong button {
		font: inherit;
		min-height: 44px;
		justify-self: start;
		padding: 0 16px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
	}
	.ok {
		color: var(--yes-text);
	}
	.go {
		font: inherit;
		min-height: 44px;
		padding: 0 20px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
</style>
