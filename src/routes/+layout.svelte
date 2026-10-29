<script lang="ts">
	import { coins } from '#lib/format.ts';
	import '#lib/styles/app.css';
	import type { LayoutProps } from './$types';
	import VisitSummary from '#lib/VisitSummary.svelte';
	import { onMount, tick } from 'svelte';
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

	const REPO = 'https://github.com/jmulliganconsulting/monoglarket';

	// Main links in bar order: everyone's pages first, then staff pages.
	const links = $derived([
		{ href: '/', text: 'Markets' },
		{ href: '/portfolio', text: 'Portfolio' },
		{ href: '/notifications', text: 'Alerts' },
		{ href: '/leaderboard', text: 'Leaderboard' },
		{ href: '/history', text: 'History' },
		{ href: '/activity', text: 'Activity' },
		{ href: '/changelog', text: 'Changelog' },
		...(data.canModerate ? [{ href: '/moderate', text: 'Manage markets' }, { href: '/markets/new', text: 'New market' }] : []),
		...(data.canResolve ? [{ href: '/resolve', text: 'Resolve' }] : []),
		...(data.isAdmin ? [{ href: '/admin', text: 'Admin' }] : [])
	]);

	// Priority nav: measure each link's natural width once, then show as many as fit and put the rest in More.
	// Server render shows the three phone tabs until the browser measures.
	let nav = $state<HTMLElement>();
	let shown = $state(3);
	let measuring = $state(false);
	let widths: number[] = [];
	let moreWidth = 0;

	const fit = () => {
		if (!nav) return;
		const style = getComputedStyle(nav);
		const gap = parseFloat(style.columnGap) || 0;
		const room = nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
		if (widths.reduce((sum, w) => sum + w + gap, -gap) <= room) return (shown = widths.length);
		let used = moreWidth;
		let n = 0;
		while (n < widths.length && used + gap + widths[n] <= room) used += gap + widths[n++];
		shown = n;
	};

	// Only the latest call measures: an older one could resume after the bar already shrank and record too few links.
	let run = 0;
	const measure = async () => {
		const id = ++run;
		shown = Infinity;
		measuring = true;
		await tick();
		if (id !== run) return;
		if (nav) {
			widths = [...nav.querySelectorAll(':scope > a')].map((a) => a.getBoundingClientRect().width);
			moreWidth = nav.querySelector('summary')?.getBoundingClientRect().width ?? 0;
		}
		measuring = false;
		fit();
	};

	// Re-measure when the links or the unread badge change, and once the web fonts arrive.
	$effect(() => {
		void [links, data.unread];
		measure();
	});
	onMount(() => void document.fonts?.ready.then(measure));
	$effect(() => {
		if (!nav) return;
		const observer = new ResizeObserver(fit);
		observer.observe(nav);
		return () => observer.disconnect();
	});

	// Saved pages belong to the member who signed in: forget them when they sign out.
	const clearSavedPages = () => navigator.serviceWorker?.controller?.postMessage('signed-out');
</script>

{#snippet label(link: { href: string; text: string })}
	{link.text}{#if link.href === '/notifications' && data.unread}<span class="count" aria-label="{data.unread} unread">{data.unread}</span>{/if}
{/snippet}

<svelte:head>
	<link rel="icon" href={data.dev ? '/sse-favicon.dev.svg' : '/sse-favicon.v1.svg'} type="image/svg+xml" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" />
	<meta name="theme-color" content={data.dev ? '#7c3aed' : '#111111'} />
	
	<!-- Link previews (Discord, Twitter/X, Slack, iMessage): the card uses these when a link is pasted. -->
	<meta name="description" content="Forecast club events with play-money coins." />
	<meta property="og:site_name" content="Monoglarket" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Monoglarket" />
	<meta property="og:description" content="Forecast club events with play-money coins." />
	<meta property="og:url" content="{page.url.origin}{page.url.pathname}" />
	<meta property="og:image" content="{page.url.origin}/og-card.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<header>
	<a href="/" class="brand"><img src="/sse-logo-kid.v3.svg" alt="Monoglarket" height="40" /></a>
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
	<!-- Every link sits in the bar in order; the ones that don't fit move into More (bottom bar on phones, dropdown on desktop). -->
	<nav aria-label="Main" bind:this={nav} data-measuring={measuring || undefined}>
		{#each links.slice(0, shown) as link (link.href)}
			<a href={link.href}>{@render label(link)}</a>
		{/each}
		{#if measuring || shown < links.length}
			<details class="more">
				<summary>More</summary>
				<div class="panel" onclick={closeMenu} role="presentation">
					{#each links.slice(shown) as link (link.href)}
						<a href={link.href}>{@render label(link)}</a>
					{/each}
				</div>
			</details>
		{/if}
	</nav>
{/if}
{#if data.summary}
	<VisitSummary summary={data.summary} />
{/if}
<main class="mx-auto max-w-page p-4 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-4">{@render children()}</main>
<!-- Modelled on jmulligan191.com's footer: centred on phones, copyright left and links right on desktop. The phone bottom nav sits over it, so it keeps main's clearance. -->
<footer class="border-t border-border pb-[calc(88px+env(safe-area-inset-bottom))] text-sm text-muted md:pb-0 [&_a]:text-fg-2">
	<div class="mx-auto flex max-w-page flex-col items-center gap-2 px-4 py-8 text-center md:flex-row md:items-start md:justify-between md:text-left">
		<div class="flex flex-col gap-1">
			<p class="m-0">Copyright © {new Date().getFullYear()} John Mulligan Consulting. All Rights Reserved.</p>
			<p class="m-0 text-xs opacity-60">Monoglarket is an unofficial site, not affiliated with or endorsed by the <a href="https://sse.rit.edu/"><abbr title="Society of Software Engineering">SSE</abbr></a>, <a href="https://rit.edu/"><abbr title="Rochester Institute of Technology">RIT</abbr></a>, or <a href="https://polymarket.com/">Polymarket</a>.</p>
		</div>
		<div class="flex flex-col items-center gap-3 md:items-end">
			<nav class="flex flex-wrap justify-center gap-x-4 gap-y-1 md:justify-end" aria-label="Footer">
				<a class="inline-flex min-h-11 items-center" href="/privacy">Privacy Policy</a>
				<a class="inline-flex min-h-11 items-center" href="/terms">Terms of Service</a>
				<a class="inline-flex min-h-11 items-center" href={REPO}>GitHub</a>
			</nav>
			<p class="m-0 text-xs opacity-60">
				Commit {#if __GIT_COMMIT__ === 'unknown'}<code>{__GIT_COMMIT__}</code>{:else}<a href="{REPO}/commit/{__GIT_COMMIT__.replace('-dirty', '')}"><code>{__GIT_COMMIT__}</code></a>{/if}
			</p>
		</div>
	</div>
</footer>

