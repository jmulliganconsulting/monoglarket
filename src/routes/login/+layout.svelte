<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="auth">{@render children()}</div>

<style>
	/* Shared look for the sign-in pages: one centred card, phone-first. */
	.auth {
		max-width: 400px;
		margin: 24px auto;
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 24px 20px;
		display: grid;
		gap: 16px;
	}
	.auth :global(h1) {
		margin: 0;
		font-size: 1.375rem;
	}
	.auth :global(p) {
		margin: 0;
		color: var(--fg-2);
	}
	.auth :global(form) {
		display: grid;
		gap: 12px;
	}
	.auth :global(label) {
		display: grid;
		gap: 6px;
		font-size: 0.875rem;
		color: var(--fg-2);
	}
	.auth :global(input) {
		height: 48px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--fg);
		font: inherit;
		font-size: 1rem;
	}
	.auth :global(input.code) {
		font-size: 1.5rem;
		letter-spacing: 0.4em;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.auth :global(button) {
		height: 48px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: #fff;
		font: inherit;
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	.auth :global(button.link) {
		height: 44px;
		background: none;
		color: var(--brand-text);
	}
	.auth :global(.error) {
		color: var(--no-text);
		font-size: 0.875rem;
	}
</style>
