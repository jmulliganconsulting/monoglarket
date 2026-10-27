<script lang="ts">
	import { coins, signedCoins } from '#lib/format.ts';
	// The visit summary popup (vault "Visit summary"). Shown once after each sign-in; dismissing it clears it.
	import { enhance } from '$app/forms';

	type Summary = { since: Date; currencies: { code: string; name: string; net: number; items: { at: Date; text: string; amount: number }[]; won: { question: string; shares: number }[]; lost: { question: string; amount: number }[] }[] };
	let { summary }: { summary: Summary } = $props();
	const when = (d: Date) => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	// Opens as a modal dialog as soon as it is on the page.
	const modal = (node: HTMLDialogElement) => node.showModal();
</script>

<dialog use:modal aria-labelledby="visit-title" class="visit">
	<h2 id="visit-title">Since your last visit</h2>
	<p class="meta">Since {when(summary.since)}</p>
	{#each summary.currencies as c (c.code)}
		<section>
			<p class="net" class:up={c.net > 0} class:down={c.net < 0}>
				{c.name}: <strong>{signedCoins(c.net)}</strong> net
			</p>
			{#each c.won as w (w.question)}
				<p class="won">Won on {w.question}: {w.shares.toFixed(2)} winning shares paid out.</p>
			{/each}
			{#each c.lost as l (l.question)}
				<p class="lost">Lost on {l.question}: {coins(l.amount)} {c.code}.</p>
			{/each}
			<details>
				<summary>Every change ({c.items.length})</summary>
				<ul>
					{#each c.items as it, i (i)}
						<li><span>{it.text}</span> <span class="amt">{signedCoins(it.amount)}</span> <span class="meta">{when(it.at)}</span></li>
					{/each}
				</ul>
			</details>
		</section>
	{/each}
	<form method="POST" action="/summary?/dismiss" use:enhance>
		<button class="go">Got it</button>
	</form>
</dialog>

<style>
	.visit {
		width: min(560px, calc(100vw - 32px));
		max-height: 85vh;
		overflow: auto;
		border: 0;
		border-radius: var(--radius-card);
		background: var(--card);
		color: var(--fg);
		padding: 20px;
		box-shadow: var(--shadow-card);
	}
	.visit::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	h2 {
		margin: 0 0 4px;
		font-size: 1.25rem;
	}
	section {
		border-top: 1px solid var(--border);
		padding: 12px 0;
	}
	p {
		margin: 4px 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.net.up strong,
	.won {
		color: var(--yes-text);
	}
	.net.down strong,
	.lost {
		color: var(--no-text);
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 8px 0 0;
		display: grid;
		gap: 6px;
		font-size: 0.875rem;
	}
	.amt {
		font-weight: var(--weight-strong);
		font-variant-numeric: tabular-nums;
	}
	summary {
		min-height: 44px;
		display: flex;
		align-items: center;
		cursor: pointer;
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
