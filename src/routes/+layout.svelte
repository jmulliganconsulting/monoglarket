<script lang="ts">
	import { coins } from '#lib/format.ts';
	import '#lib/styles/app.css';
	import type { LayoutProps } from './$types';
	import VisitSummary from '#lib/VisitSummary.svelte';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';

	let { children, data }: LayoutProps = $props();

	// JSON-LD for the site. Built in script so the page's origin fills in (Svelte does not interpolate inside a <script> tag).
	const websiteLd = $derived(JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: 'Monoglarket',
		description: 'Forecast club events with play-money coins.',
		url: page.url.origin,
	}));

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
		{ href: '/leaderboard', text: 'Leaderboard' },
		{ href: '/rules', text: 'Rules' },
		{ href: '/activity', text: 'Activity' },
		{ href: '/changelog', text: 'Changelog' },
		{ href: '/history', text: 'History' },
		{ href: '/notifications', text: 'Alerts' },
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

	// A bar item: phone tab that shares the bar, natural width while measuring and on desktop. 44 px tap target (NFR-09).
	const tab = 'flex min-h-11 flex-none cursor-pointer list-none items-center whitespace-nowrap px-3 text-[0.8125rem] text-fg-2 no-underline [&::-webkit-details-marker]:hidden';

	// Saved pages belong to the member who signed in: forget them when they sign out.
	const clearSavedPages = () => navigator.serviceWorker?.controller?.postMessage('signed-out');
</script>

{#snippet label(link: { href: string; text: string })}
	{link.text}{#if link.href === '/notifications' && data.unread}<span class="ml-1 inline-block min-w-[1.4em] rounded-pill bg-fg px-[5px] text-center text-xs font-strong text-bg" aria-label="{data.unread} unread">{data.unread}</span>{/if}
{/snippet}

<svelte:head>
	<!-- meta descriptions -->
	<!-- title set elsewhere -->
	<meta name="description" content="Forecast club events with play-money coins." />
	<link rel="canonical" href="{page.url.origin}{page.url.pathname}" />
	<meta name="robots" content="index, follow" />

	<!-- icons -->
	<link rel="icon" href={data.dev ? '/sse-favicon.dev.svg' : '/sse-favicon.v1.svg'} type="image/svg+xml" />
	<link rel="icon" href={data.dev ? '/sse-favicon.dev.png' : '/sse-favicon.v1.png'} type="image/png" />
	<link rel="apple-touch-icon" href={data.dev ? '/sse-favicon.dev.png' : '/sse-favicon.v1.png'} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content={data.dev ? '#7c3aed' : '#111111'} />

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" />
	
	<!-- open graph and more descriptions -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content="{page.url.origin}{page.url.pathname}" />
	<meta property="og:title" content="Monoglarket" />
	<meta property="og:description" content="Forecast club events with play-money coins." />
	<meta property="og:image" content="{page.url.origin}/og-card.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Monoglarket logo" />
	<meta property="og:site_name" content="Monoglarket" />
	<meta property="og:locale" content="en_US" />
	<meta property="og:pubdate" content="{new Date().toISOString()}" />

	<!-- social media specific meta tags -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Monoglarket" />
	<meta name="twitter:description" content="Forecast club events with play-money coins." />
	<meta name="twitter:image" content="{page.url.origin}/og-card.png" />
	<meta name="twitter:image:width" content="1200" />
	<meta name="twitter:image:height" content="630" />
	<meta name="twitter:image:alt" content="Monoglarket logo" />
	<!--
	<meta name="twitter:site" content="@monoglarket" /> 
	-->
	<!-- Discord component embed: buttons and a card for this page, read from /embed (see previews/previews.ts). -->
	<link rel="discord:component-embed" type="application/json" href="{page.url.origin}/embed?url={encodeURIComponent(page.url.href)}" />

	<!-- structured data -->
	{@html `<script type="application/ld+json">${websiteLd}</script>`}

</svelte:head>

<!-- Wraps on narrow phones so the name and Sign out button stay on screen. Dev site: solid violet with white text; the logo's light lettering stays readable on it. -->
<header class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-2 text-lg font-strong dev:border-b-[#5b21b6] dev:bg-[#6d28d9] dev:text-fg dev:[--card-2:#ffffff33] dev:[--fg-2:#ede9fe] dev:[--fg:#fff]">
	<a href="/" class="text-inherit no-underline"><img class="block h-10 w-auto" src="/sse-logo-kid.v3.svg" alt="Monoglarket" height="40" /></a>
	{#if data.user && data.onboarded}
		<!-- Every link sits in the nav in order; the ones that don't fit move into More. While measuring, the nav hides overflow. -->
		<nav class="flex min-w-0 flex-1 gap-2 data-measuring:overflow-hidden" aria-label="Main" bind:this={nav} data-measuring={measuring || undefined}>
			{#each links.slice(0, shown) as link (link.href)}
				<a class={tab} href={link.href}>{@render label(link)}</a>
			{/each}
			{#if measuring || shown < links.length}
				<details class="relative flex-none">
					<summary class={tab}>More</summary>
					<div class="absolute top-[calc(100%+4px)] right-0 z-10 grid max-h-[70vh] w-[min(280px,calc(100vw-16px))] gap-2 overflow-auto rounded-card bg-card px-3 py-2 shadow-card" onclick={closeMenu} role="presentation">
						{#each links.slice(shown) as link (link.href)}
							<a class="flex min-h-11 items-center text-fg no-underline" href={link.href}>{@render label(link)}</a>
						{/each}
					</div>
				</details>
			{/if}
		</nav>
	{/if}
	{#if data.user}
		<a href="/portfolio" class="mr-4 ml-auto flex items-center gap-1.5 text-base text-inherit tabular-nums no-underline" aria-label="Balance: {coins(data.coins)} {data.coinCode}"><img class="size-7" src="/sse-coin.svg" alt="" width="28" height="28" />{coins(data.coins)}</a>
		<form class="flex items-center gap-2 text-sm font-body text-fg-2" method="POST" action="/logout" onsubmit={clearSavedPages}>
			<a class="text-inherit no-underline" href="/account">{data.user.displayName}</a>
			<button class="h-11 cursor-pointer rounded-pill border-0 bg-card-2 px-3 text-fg [font:inherit]">Sign out</button>
		</form>
	{/if}
</header>
<p class="m-0 hidden border-b border-border bg-card px-4 py-2 text-center font-semibold offline:block" role="status">You're offline. Showing what was saved on this device; trading is paused until you reconnect.</p>
{#if data.summary}
	<VisitSummary summary={data.summary} />
{/if}
<main class="mx-auto max-w-page p-4">{@render children()}</main>
<!-- Modelled on jmulligan191.com's footer: centred on phones, copyright left and links right on desktop. -->
<footer class="border-t border-border text-sm text-muted [&_a]:text-fg-2">
	<div class="mx-auto grid max-w-page items-center justify-items-center gap-x-8 gap-y-2 px-4 py-8 text-center md:grid-cols-[1fr_auto] md:justify-items-stretch md:text-left">
		<p class="m-0 md:col-start-1 md:row-start-1">Copyright © {new Date().getFullYear()} John Mulligan Consulting. All Rights Reserved.</p>
		<p class="m-0 text-xs opacity-60 md:col-start-1 md:row-start-2">Monoglarket is an unofficial site, not affiliated with or endorsed by the <a href="https://sse.rit.edu/"><abbr title="Society of Software Engineering">SSE</abbr></a>, <a href="https://rit.edu/"><abbr title="Rochester Institute of Technology">RIT</abbr></a>, or <a href="https://polymarket.com/">Polymarket</a>.</p>
		<nav class="flex flex-wrap justify-center gap-x-4 gap-y-1 md:col-start-2 md:row-start-1 md:justify-end" aria-label="Footer">
			<a class="inline-flex min-h-11 items-center" href="/privacy">Privacy Policy</a>
			<a class="inline-flex min-h-11 items-center" href="/terms">Terms of Service</a>
			<a class="inline-flex min-h-11 items-center" href={REPO}>GitHub</a>
		</nav>
		<p class="m-0 text-xs opacity-60 md:col-start-2 md:row-start-2 md:justify-self-end">Deployed <time datetime={__DEPLOYED_AT__}>{new Date(__DEPLOYED_AT__).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time> · {#if __GIT_COMMIT__ === 'unknown'}<code>{__GIT_COMMIT__}</code>{:else}<a href="{REPO}/commit/{__GIT_COMMIT__.replace('-dirty', '')}"><code>{__GIT_COMMIT__}</code></a>{/if}</p>
	</div>
</footer>

