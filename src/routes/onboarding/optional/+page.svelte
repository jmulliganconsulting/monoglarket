<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Optional · Monoglarket</title></svelte:head>

<p class="step">Step 5 of 6</p>
<h1>Connect later, or now</h1>
<p class="lede">Discord, GitHub and LinkedIn are optional. You can connect them any time on your account page.</p>

<form method="POST">
	<button class="go">Continue</button>
	<p class="meta"><a href="/account">Open account settings</a> · <button class="link">Skip for now</button></p>
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
		justify-items: start;
	}
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
		margin: 0;
	}
	a {
		color: inherit;
	}
	.go,
	.link {
		font: inherit;
		min-height: 44px;
		border: 0;
		cursor: pointer;
	}
	.go {
		padding: 0 20px;
		border-radius: var(--radius-pill);
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
	}
	.link {
		background: none;
		color: inherit;
		text-decoration: underline;
		padding: 0;
	}
</style>
