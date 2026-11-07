<script lang="ts">
	// The accordion under a market: rules, timeline, insider trading and FAQ (modelled on Polymarket's event page).
	import { dateTime } from '#lib/format.ts';
	import { SELL_FEE } from '../engine/fees.ts';

	type Props = {
		question: string;
		criteria: string;
		currency: string;
		createdAt: Date;
		closeAt: Date | null;
		resolvedAt: Date | null;
		disputeUntil: Date | null;
	};
	let { question, criteria, currency, createdAt, closeAt, resolvedAt, disputeUntil }: Props = $props();

	const now = new Date();
	const steps = $derived([
		{ label: 'Market opens', at: createdAt, later: '' },
		{ label: 'Trading ends', at: closeAt, later: 'No end time: trading runs until a moderator resolves it' },
		{ label: 'Resolved and paid out', at: resolvedAt, later: 'Once the result is known. Winners are paid at once' },
		{ label: 'Result final', at: disputeUntil, later: '24 hours after it resolves, if nobody disputes it' },
	]);

	const faq = $derived([
		[`What is the “${question}” market?`, `This market lets you trade on the outcome of “${question}”. Prices show the market's current estimate of each outcome's chance.`],
		['How are prices set?', 'Prices move with supply and demand as people buy and sell shares. A price of 60% means the market thinks there is a 60% chance.'],
		['When does this market resolve?', 'When the outcome is known, under the market rules above. A moderator confirms the result, and anyone can dispute it for 24 hours after.'],
		['Can I sell before it resolves?', `Yes. Sell at the current price any time trading is open. Selling has a ${SELL_FEE * 100}% fee.`],
		['What happens if I hold winning shares?', `Each winning share pays 1 ${currency} when the market resolves. Your profit is that minus what you paid per share.`],
		['Is this real money?', `No. ${currency} are play money with no cash value.`],
	]);

	const item = 'border-b border-border last:border-b-0';
	const summary = 'flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-base font-strong [&::-webkit-details-marker]:hidden';
	const chevron = 'text-xl leading-none text-muted transition-transform group-open:rotate-180';
	const body = 'grid gap-3 pb-4 text-sm text-fg-2 [&_p]:m-0';
</script>

<section class="rounded-card bg-card px-4 shadow-card max-[899px]:order-2" aria-label="About this market">
	<details class="group {item}">
		<summary class={summary}>Market rules <span class={chevron} aria-hidden="true">▾</span></summary>
		<div class="{body} whitespace-pre-line">
			<p>{criteria}</p>
			<p>See the <a href="/rules">site's market rules</a> for how markets are resolved and voided.</p>
		</div>
	</details>

	<details class="group {item}">
		<summary class={summary}>Timeline &amp; payout <span class={chevron} aria-hidden="true">▾</span></summary>
		<ol class="{body} m-0 list-none p-0">
			{#each steps as s (s.label)}
				{@const done = !!s.at && s.at <= now}
				<li class="flex gap-3">
					<span class={['mt-1 size-3 shrink-0 rounded-full border-2', done ? 'border-fg bg-fg' : 'border-muted']} aria-hidden="true"></span>
					<span>
						<span class="sr-only">{done ? 'Completed:' : 'Upcoming:'}</span>
						<strong class="block text-fg">{s.label}</strong>
						{s.at ? dateTime(s.at) : s.later}
					</span>
				</li>
			{/each}
		</ol>
	</details>

	<details class="group {item}">
		<summary class={summary}>Insider trading rules <span class={chevron} aria-hidden="true">▾</span></summary>
		<div class={body}>
			<p>Insider trading and market manipulation are not allowed. Moderators may forfeit the winnings of anyone who breaks these rules.</p>
			<p><strong class="text-fg">Don't trade on an outcome you can influence.</strong> If you can control or directly affect the result, don't trade on this market.</p>
			<p><strong class="text-fg">Don't trade on information you shouldn't have.</strong> No trading on non-public information about the outcome that was shared with you in confidence.</p>
			<p><strong class="text-fg">Don't manipulate prices.</strong> No trades meant to move the price artificially or mislead others about the chance of an outcome.</p>
		</div>
	</details>

	<details class="group {item}">
		<summary class={summary}>Frequently asked questions <span class={chevron} aria-hidden="true">▾</span></summary>
		<div class={body}>
			{#each faq as [q, a] (q)}
				<div class="grid gap-1">
					<h3 class="m-0 text-sm font-strong text-fg">{q}</h3>
					<p>{a}</p>
				</div>
			{/each}
		</div>
	</details>
</section>
