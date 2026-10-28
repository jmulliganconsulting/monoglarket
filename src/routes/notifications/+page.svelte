<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const when = (d: Date) => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const label: Record<string, string> = { resolved: 'Resolved', disputed: 'Disputed', closing: 'Closing soon', overdue: 'Overdue', overdue_admin: 'Overdue' };

	// Web push: this device subscribes with the browser's push service, then tells the server (vault "Alerts").
	let pushOn = $state(false);
	let pushError = $state('');
	$effect(() => {
		pushOn = data.pushAlerts;
	});
	const fromBase64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
	async function togglePush() {
		pushError = '';
		try {
			const reg = await navigator.serviceWorker.ready;
			if (pushOn) {
				const sub = await reg.pushManager.getSubscription();
				if (sub) {
					await fetch('/notifications/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
					await sub.unsubscribe();
				}
				pushOn = false;
				return;
			}
			if ((await Notification.requestPermission()) !== 'granted') throw new Error('Allow notifications in your browser settings to get alerts.');
			const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64(data.vapidPublicKey!) });
			const res = await fetch('/notifications/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
			if (!res.ok) throw new Error('This device could not be saved. Try again.');
			pushOn = true;
		} catch (e) {
			pushError = e instanceof Error ? e.message : 'Alerts could not be turned on here.';
		}
	}
</script>

<svelte:head><title>Alerts · Monoglarket</title></svelte:head>

<h1>Alerts</h1>
{#if data.pushReady}
	<section class="push card">
		<p>{pushOn ? 'Alerts are on for this device.' : 'Get an alert on this phone or browser when a market you hold resolves, closes soon, or is disputed.'}</p>
		<button class="quiet" onclick={togglePush}>{pushOn ? 'Turn off alerts on this device' : 'Turn on alerts on this device'}</button>
		{#if pushError}<p class="error" role="alert">{pushError}</p>{/if}
	</section>
{/if}

{#if data.items.some((i) => !i.readAt)}
	<form method="POST" action="?/markAllRead"><button class="quiet">Mark all read</button></form>
{/if}

{#if data.items.length === 0}
	<p class="meta">Nothing yet. You'll hear here when a market you hold resolves, closes soon, or is disputed.</p>
{:else}
	<ul>
		{#each data.items as i (i.id)}
			<li class:unread={!i.readAt}>
				<span class="kind">{label[i.kind] ?? i.kind}</span>
				<p>{#if i.marketId}<a href="/markets/{i.marketId}">{i.text}</a>{:else}{i.text}{/if}</p>
				<span class="meta">{when(i.createdAt)}</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.meta {
		color: var(--muted);
		font-size: 0.875rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 12px 0 0;
		display: grid;
		gap: 8px;
	}
	li {
		background: var(--card);
		border-radius: var(--radius-card);
		padding: 12px 16px;
		display: grid;
		gap: 4px;
	}
	li.unread {
		box-shadow: inset 4px 0 0 var(--fg);
	}
	.kind {
		font-size: 0.8125rem;
		color: var(--fg-2);
		font-weight: var(--weight-strong);
	}
	p {
		margin: 0;
	}
	a {
		color: inherit;
	}
	button {
		font: inherit;
		min-height: 44px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--card-2);
		color: var(--fg);
		cursor: pointer;
	}
</style>
