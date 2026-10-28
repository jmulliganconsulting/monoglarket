<script lang="ts">
	import { coins } from '#lib/format.ts';
	import TakeBreak from '#lib/TakeBreak.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>You're in · MonoGlarket</title></svelte:head>

<p class="step">Step 6 of 6</p>
<h1>You're in</h1>
<p class="lede">
	{#each data.grants as g, i (g.code)}{i ? ' and ' : ''}{coins(g.signupGrant)} {g.code}{/each}
	are yours when you press the button below. Trade them on any open market.
</p>

<form method="POST" action="?/finish">
	<button class="go">Start trading</button>
</form>

<div class="break-block">
	<TakeBreak action="?/break" until={data.until} error={form?.breakError} />
</div>

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
	.break-block {
		margin-top: 32px;
	}
</style>
