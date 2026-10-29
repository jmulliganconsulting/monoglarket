<script lang="ts">
	// Take a break (vault "Signup and profile"). Members pick a length; only an admin can end one early.
	let { action, until, error }: { action: string; until: Date | null; error?: string } = $props();
	const on = $derived(!!until && until > new Date());
	const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<section class="[&_p]:mt-0 [&_p]:mb-3 [&_p]:text-fg-2" aria-labelledby="break-title">
	<h2 class="mt-0 mb-2 text-lg" id="break-title">Take a break</h2>
	{#if on && until}
		<p>You're on a break until {when(until)}. You can still look around, and payouts still arrive. Trading, proposing markets and requesting a resolution are paused. Only an admin can end it early.</p>
	{:else}
		<p>Step away from trading for a while. You can still look around, and payouts still arrive. Trading, proposing markets and requesting a resolution are paused. You can't end a break early; only an admin can.</p>
	{/if}
	<form method="POST" action={action} class="flex flex-wrap gap-2">
		<button class="min-h-11 cursor-pointer rounded-pill border-0 bg-card-2 px-4 text-fg [font:inherit]" name="length" value="day">1 day</button>
		<button class="min-h-11 cursor-pointer rounded-pill border-0 bg-card-2 px-4 text-fg [font:inherit]" name="length" value="week">1 week</button>
		<button class="min-h-11 cursor-pointer rounded-pill border-0 bg-card-2 px-4 text-fg [font:inherit]" name="length" value="month">1 month</button>
	</form>
	{#if error}<p class="text-no-text!" role="alert">{error}</p>{/if}
</section>

