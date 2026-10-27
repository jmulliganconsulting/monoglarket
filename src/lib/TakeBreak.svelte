<script lang="ts">
	// Take a break (vault "Signup and profile"). Members pick a length; only an admin can end one early.
	let { action, until, error }: { action: string; until: Date | null; error?: string } = $props();
	const on = $derived(!!until && until > new Date());
	const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<section class="break" aria-labelledby="break-title">
	<h2 id="break-title">Take a break</h2>
	{#if on && until}
		<p>You're on a break until {when(until)}. You can still look around, and payouts still arrive. Trading, proposing markets and requesting a resolution are paused. Only an admin can end it early.</p>
	{:else}
		<p>Step away from trading for a while. You can still look around, and payouts still arrive. Trading, proposing markets and requesting a resolution are paused. You can't end a break early; only an admin can.</p>
	{/if}
	<form method="POST" action={action} class="choices">
		<button name="length" value="day">1 day</button>
		<button name="length" value="week">1 week</button>
		<button name="length" value="month">1 month</button>
	</form>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.break h2 {
		font-size: 1.125rem;
		margin: 0 0 8px;
	}
	.break p {
		color: var(--fg-2);
		margin: 0 0 12px;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.choices button {
		font: inherit;
		min-height: 44px;
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
</style>
