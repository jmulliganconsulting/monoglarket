<script lang="ts">
	import { coins } from '#lib/format.ts';
	import '#lib/styles/tokens.css';
	import type { LayoutProps } from './$types';
	import VisitSummary from '#lib/VisitSummary.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let { children, data }: LayoutProps = $props();

	// Choosing a link closes the More menu.
	const closeMenu = (e: MouseEvent) => {
		if ((e.target as HTMLElement).closest('a')) (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
	};

	// Service worker for installing the app (FR-28). Registered once in the browser; it doesn't cache pages.
	onMount(() => {
		if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
		// Offline: show the banner and pause the trade and send buttons (vault "Mobile experience").
		const setOffline = () => document.documentElement.toggleAttribute('data-offline', !navigator.onLine);
		setOffline();
		addEventListener('online', setOffline);
		addEventListener('offline', setOffline);
	});

	// Saved pages belong to the member who signed in: forget them when they sign out.
	const clearSavedPages = () => navigator.serviceWorker?.controller?.postMessage('signed-out');
</script>

<svelte:head>
	<link rel="icon" href={data.dev ? '/sse-favicon.dev.svg' : '/sse-favicon.v1.svg'} type="image/svg+xml" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" />
	<meta name="theme-color" content={data.dev ? '#7c3aed' : '#111111'} />
	
	<!-- Link previews (Discord, Twitter/X, Slack, iMessage): the card uses these when a link is pasted. -->
	<meta name="description" content="Forecast club events with play-money coins." />
	<meta property="og:site_name" content="MonoGlarket" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="MonoGlarket" />
	<meta property="og:description" content="Forecast club events with play-money coins." />
	<meta property="og:url" content="{page.url.origin}{page.url.pathname}" />
	<meta property="og:image" content="{page.url.origin}/og-card.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<header>
	<a href="/" class="brand"><img src="/sse-logo-kid.v3.svg" alt="MonoGlarket" height="40" /></a>
	<p class="offline-note" role="status">You're offline. Showing what was saved on this device; trading is paused until you reconnect.</p>
	{#if data.user}
		<a href="/portfolio" class="balance" aria-label="Balance: {coins(data.coins)} {data.coinCode}"><img src="/sse-coin.svg" alt="" width="28" height="28" />{coins(data.coins)}</a>
		<form method="POST" action="/logout" onsubmit={clearSavedPages}>
			<a href="/account">{data.user.displayName}</a>
			<button>Sign out</button>
		</form>
	{/if}
</header>
{#if data.user && data.onboarded}
	<!-- Phone: three main tabs and More. Desktop: the same, with More as a dropdown. The menu closes when a link is chosen. -->
	<nav aria-label="Main">
		<a href="/">Markets</a>
		<a href="/portfolio">Portfolio</a>
		<a href="/notifications" class="alerts">Alerts{#if data.unread}<span class="count" aria-label="{data.unread} unread">{data.unread}</span>{/if}</a>
		{#if data.canModerate}<a href="/moderate">Manage markets</a>{/if}
		{#if data.isAdmin}<a href="/admin">Admin</a>{/if}
		<details class="more">
			<summary>More</summary>
			<div class="panel" onclick={closeMenu} role="presentation">
				<section>
					<h3>Browse</h3>
					<a href="/history">History</a>
					<a href="/leaderboard">Leaderboard</a>
					<a href="/activity">Activity</a>
				</section>
				{#if data.canModerate || data.canResolve}
					<section>
						<h3>Staff</h3>
						{#if data.canModerate}<a href="/markets/new">New market</a>{/if}
						{#if data.canResolve}<a href="/resolve">Resolve</a>{/if}
					</section>
				{/if}
			</div>
		</details>
	</nav>
{/if}
{#if data.summary}
	<VisitSummary summary={data.summary} />
{/if}
<main>{@render children()}</main>
<footer>
	<div class="foot">
		<div class="notice">
			<p>Copyright © {new Date().getFullYear()} - John Mulligan Consulting. All Rights Reserved.</p>
			<p class="build">MonoGlarket is an unofficial site, not affiliated with or endorsed by SSE, RIT, or Polymarket.</p>
		</div>
		<div class="links">
			<nav class="legal-links" aria-label="Legal">
				<a href="/privacy">Privacy Policy</a>
				<a href="/terms">Terms of Service</a>
			</nav>
			<p class="build">Commit <code>{__GIT_COMMIT__}</code></p>
		</div>
	</div>
</footer>

<style>
	/* Offline (FR-29): the banner shows, and every green action button is paused so nothing is attempted without a connection. */
	.offline-note {
		display: none;
		flex-basis: 100%;
		margin: 0;
		font-weight: 600;
	}
	:global([data-offline]) .offline-note {
		display: block;
	}
	:global([data-offline] .go) {
		opacity: 0.5;
		pointer-events: none;
	}

	/* Phone-first (vault: Mobile experience). Look follows vault: Design reference. */
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--fg);
		font-family: var(--font);
		font-weight: var(--weight);
		line-height: 1.5;
	}
	/* Wraps on narrow phones so the name and Sign out button stay on screen instead of running off the right edge. */
	header {
		min-height: 56px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 16px;
		padding-top: calc(8px + env(safe-area-inset-top));
		border-bottom: 1px solid var(--border);
		font-weight: var(--weight-strong);
		font-size: 1.125rem;
	}
	header a {
		color: inherit;
		text-decoration: none;
	}
	header .brand img {
		display: block;
		height: 40px;
		width: auto;
	}
	header .balance {
		margin-left: auto;
		margin-right: 16px;
		display: flex;
		align-items: center;
		gap: 6px;
		font-variant-numeric: tabular-nums;
		font-size: 1rem;
	}
	header .balance img {
		width: 28px;
		height: 28px;
	}
	header form {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.875rem;
		font-weight: var(--weight);
		color: var(--fg-2);
	}
	header button {
		height: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		font: inherit;
		cursor: pointer;
	}
	/* Dev site (APP_ENV=dev): a solid violet header with white text. The logo's light lettering stays readable on it. */
	:global([data-env='dev']) header {
		--fg: #fff;
		--fg-2: #ede9fe;
		--card-2: #ffffff33;
		background: #6d28d9;
		color: var(--fg);
		border-bottom-color: #5b21b6;
	}
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 16px;
		padding-bottom: calc(88px + env(safe-area-inset-bottom));
	}
	/* Bottom nav on phones; every item is a 44 px tap target (NFR-09). */
	nav[aria-label='Main'] {
		position: fixed;
		inset: auto 0 0 0;
		display: flex;
		justify-content: space-around;
		background: var(--card);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 10;
	}
	nav[aria-label='Main'] > a,
	nav[aria-label='Main'] summary {
		flex: 1;
		min-height: 44px;
		display: grid;
		place-items: center;
		color: var(--fg-2);
		font-size: 0.8125rem;
		text-decoration: none;
		cursor: pointer;
		list-style: none;
	}
	nav summary::-webkit-details-marker {
		display: none;
	}
	.count {
		display: inline-block;
		min-width: 1.4em;
		margin-left: 4px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--fg);
		color: var(--bg);
		font-size: 0.75rem;
		font-weight: var(--weight-strong);
		text-align: center;
	}
	.more {
		flex: 1;
		display: flex;
		justify-content: center;
	}
	/* The More panel opens above the bar on phones, and below the bar on desktop. */
	.panel {
		position: absolute;
		right: 8px;
		bottom: calc(100% + 8px);
		width: min(280px, calc(100vw - 16px));
		max-height: 70vh;
		overflow: auto;
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 8px 12px;
		display: grid;
		gap: 8px;
	}
	.panel section {
		display: grid;
	}
	.panel h3 {
		margin: 8px 0 2px;
		font-size: 0.75rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.panel a {
		min-height: 44px;
		display: flex;
		align-items: center;
		color: var(--fg);
		text-decoration: none;
	}
	@media (min-width: 768px) {
		nav[aria-label='Main'] {
			position: static;
			justify-content: flex-start;
			gap: 8px;
			max-width: 1100px;
			margin: 0 auto;
			border: 0;
			padding: 0 16px;
		}
		nav[aria-label='Main'] > a,
		nav[aria-label='Main'] summary {
			flex: none;
			padding: 0 12px;
		}
		.more {
			flex: none;
			position: relative;
		}
		.panel {
			right: 0;
			top: calc(100% + 4px);
			bottom: auto;
		}
		main {
			padding-bottom: 16px;
		}
	}
	/* Modelled on jmulligan191.com's footer: centred on phones, copyright left and links right on desktop. */
	/* The phone bottom nav sits over the footer, so it keeps the same clearance as main. */
	footer {
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.875rem;
		padding-bottom: calc(88px + env(safe-area-inset-bottom));
	}
	.foot {
		max-width: 1100px;
		margin: 0 auto;
		padding: 32px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
	}
	.notice {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.notice p,
	.build {
		margin: 0;
	}
	.build {
		font-size: 0.75rem;
		opacity: 0.6;
	}
	.links {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	footer a {
		color: var(--fg-2);
	}
	.legal-links {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px 16px;
	}
	@media (min-width: 768px) {
		footer {
			padding-bottom: 0;
		}
		.foot {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-start;
			text-align: left;
		}
		.links {
			align-items: flex-end;
		}
		.legal-links {
			justify-content: flex-end;
		}
	}
	.legal-links a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	:global(h1) {
		font-family: var(--font-display);
		font-stretch: var(--stretch-display);
		font-size: 2.25rem;
		line-height: 1.1;
		font-weight: 650;
		margin: 8px 0 16px;
	}
</style>
