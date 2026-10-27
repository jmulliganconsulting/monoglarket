<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// Stops the submit before it is sent when the resolver backs out.
	const confirmFirst = (e: SubmitEvent) => {
		if (!confirm('Resolve this market now? Winners are paid straight away.')) e.preventDefault();
	};
</script>

<svelte:head><title>Resolve · Club Predictions</title></svelte:head>

<h1>Resolve</h1>
<p class="meta">Markets an admin has trusted to you. Your result is final at once, but it can still be disputed for 24 hours.</p>
{#if form?.done}<p class="ok" role="status">{form.done}</p>{/if}

{#if data.markets.length === 0}<p class="meta">Nothing to resolve right now.</p>{/if}
{#each data.markets as m (m.id)}
	<article class="card">
		<h2>{m.question}</h2>
		<p>{m.criteria}</p>
		<form method="POST" action="?/resolve" onsubmit={confirmFirst}>
			<input type="hidden" name="marketId" value={m.id} />
			<label class="field">
				Winner
				<select name="outcomeId" required>
					{#each m.outcomes as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
				</select>
			</label>
			<label class="field">
				Evidence: a link, or a sentence. Everyone can read it.
				<textarea name="evidence" rows="2" required maxlength="500"></textarea>
			</label>
			<button class="go">Resolve</button>
			{#if form?.error && form.marketId === m.id}<p class="error" role="alert">{form.error}</p>{/if}
		</form>
		<a href="/markets/{m.id}" class="meta">Open market</a>
	</article>
{/each}

<style>
	.card {
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px;
		margin-bottom: 12px;
		display: grid;
		gap: 8px;
	}
	.card h2 {
		font-size: 1rem;
		margin: 0;
	}
	.card p {
		margin: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	form {
		display: grid;
		gap: 12px;
	}
	.field {
		display: grid;
		gap: 4px;
	}
	select,
	textarea {
		font: inherit;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--fg);
	}
	select {
		min-height: 44px;
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
		justify-self: start;
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
		margin: 0;
	}
	.ok {
		color: var(--yes-text);
	}
</style>
