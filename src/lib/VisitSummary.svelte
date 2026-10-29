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

<dialog use:modal aria-labelledby="visit-title" class="max-h-[85vh] w-[min(560px,calc(100vw-32px))] overflow-auto rounded-card border-0 bg-card p-5 text-fg shadow-card backdrop:bg-black/50 [&_p]:my-1">
	<h2 class="mt-0 mb-1 text-xl" id="visit-title">Since your last visit</h2>
	<p class="text-sm text-muted">Since {when(summary.since)}</p>
	{#each summary.currencies as c (c.code)}
		<section class="border-t border-border py-3">
			<p>
				{c.name}: <strong class={c.net > 0 ? 'text-yes-text' : c.net < 0 ? 'text-no-text' : ''}>{signedCoins(c.net)}</strong> net
			</p>
			{#each c.won as w (w.question)}
				<p class="text-yes-text">Won on {w.question}: {w.shares.toFixed(2)} winning shares paid out.</p>
			{/each}
			{#each c.lost as l (l.question)}
				<p class="text-no-text">Lost on {l.question}: {coins(l.amount)} {c.code}.</p>
			{/each}
			<details>
				<summary class="flex min-h-11 cursor-pointer items-center">Every change ({c.items.length})</summary>
				<ul class="mt-2 mb-0 grid list-none gap-1.5 p-0 text-sm">
					{#each c.items as it, i (i)}
						<li><span>{it.text}</span> <span class="font-strong tabular-nums">{signedCoins(it.amount)}</span> <span class="text-sm text-muted">{when(it.at)}</span></li>
					{/each}
				</ul>
			</details>
		</section>
	{/each}
	<form method="POST" action="/summary?/dismiss" use:enhance>
		<button class="go min-h-11 cursor-pointer rounded-pill border-0 bg-fg px-5 font-strong text-bg [font-family:inherit] [font-size:inherit]">Got it</button>
	</form>
</dialog>

