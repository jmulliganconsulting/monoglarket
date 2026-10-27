<script lang="ts">
	import TakeBreak from '#lib/TakeBreak.svelte';
	import BirthdayFields from '#lib/BirthdayFields.svelte';
	import type { PageProps } from './$types';

	import { page } from '$app/state';

	let { data, form }: PageProps = $props();

	// Set by /account/linkedin/callback.
	const LINKEDIN_MESSAGES: Record<string, string> = {
		connected: 'LinkedIn connected.',
		failed: "LinkedIn didn't connect. Try again.",
		taken: 'That LinkedIn account is already connected to another SSE member.',
		no_member: "Your email isn't on the SSE website yet, so there's nothing to connect it to.",
	};
	const linkedInMessage = $derived(LINKEDIN_MESSAGES[page.url.searchParams.get('linkedin') ?? '']);

	// Set by /account/github/callback.
	const GITHUB_MESSAGES: Record<string, string> = {
		connected: 'GitHub connected.',
		failed: "GitHub didn't connect. Try again.",
		taken: 'That GitHub account is already connected to another SSE member.',
		no_member: "Your email isn't on the SSE website yet, so there's nothing to connect it to.",
	};
	const gitHubMessage = $derived(GITHUB_MESSAGES[page.url.searchParams.get('github') ?? '']);

	// Set by /account/discord/callback.
	const DISCORD_MESSAGES: Record<string, string> = {
		connected: 'Discord connected.',
		failed: "Discord didn't connect. Try again.",
		taken: 'That Discord account is already connected to another SSE member.',
		no_member: "Your email isn't on the SSE website yet, so there's nothing to connect it to.",
	};
	const discordMessage = $derived(DISCORD_MESSAGES[page.url.searchParams.get('discord') ?? '']);
</script>

<svelte:head><title>Account · Club Predictions</title></svelte:head>

<div class="card">
	<h1>{data.hasPassword || form?.saved ? 'Change password' : 'Set a password'}</h1>
	<p>Then you can sign in with {data.email} and this password. Other signed-in browsers will be signed out.</p>
	<form method="POST" action="?/password">
		<input type="email" autocomplete="username" value={data.email} hidden readonly />
		<label>
			New password
			<input name="password" type="password" autocomplete="new-password" minlength="8" required />
		</label>
		<label>
			Confirm password
			<input name="confirm" type="password" autocomplete="new-password" minlength="8" required />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved}<p role="status">Password saved.</p>{/if}
		<button>Save password</button>
	</form>
</div>

{#if data.linkedIn.enabled}
	<div class="card">
		<h1>LinkedIn</h1>
		{#if !data.linkedIn.onSse}
			<p>Connecting LinkedIn needs an SSE website account with {data.email}.</p>
		{:else if data.linkedIn.connected && !form?.disconnected}
			<p>Your LinkedIn account is connected to your SSE profile, so your profile stays linked even if you change your LinkedIn URL.</p>
			<form method="POST" action="?/disconnectLinkedIn">
				<button class="secondary">Disconnect LinkedIn</button>
			</form>
		{:else}
			<p>Sign in with LinkedIn once to confirm which LinkedIn account is yours. We only receive LinkedIn's ID for your account.</p>
			<a class="button" href="/account/linkedin" data-sveltekit-reload>Connect LinkedIn</a>
		{/if}
		{#if form?.disconnected}<p role="status">LinkedIn disconnected.</p>
		{:else if linkedInMessage}<p class={page.url.searchParams.get('linkedin') === 'connected' ? '' : 'error'} role="status">{linkedInMessage}</p>{/if}
	</div>
{/if}

{#if data.gitHub.enabled}
	<div class="card">
		<h1>GitHub</h1>
		{#if !data.gitHub.onSse}
			<p>Connecting GitHub needs an SSE website account with {data.email}.</p>
		{:else if data.gitHub.login && !form?.gitHubDisconnected}
			<p>GitHub account <strong>{data.gitHub.login}</strong> is connected to your SSE profile.</p>
			{#if data.gitHub.profileMismatch}<p>Your SSE profile lists <strong>{data.gitHub.profileMismatch}</strong>; update it on the SSE website to match.</p>{/if}
			<form method="POST" action="?/disconnectGitHub">
				<button class="secondary">Disconnect GitHub</button>
			</form>
		{:else}
			<p>Sign in with GitHub once to confirm which GitHub account is yours. We only receive your public GitHub profile.</p>
			<a class="button" href="/account/github" data-sveltekit-reload>Connect GitHub</a>
		{/if}
		{#if form?.gitHubDisconnected}<p role="status">GitHub disconnected.</p>
		{:else if gitHubMessage}<p class={page.url.searchParams.get('github') === 'connected' ? '' : 'error'} role="status">{gitHubMessage}</p>{/if}
	</div>
{/if}

{#if data.discord.enabled}
	<div class="card">
		<h1>Discord</h1>
		{#if !data.discord.onSse}
			<p>Connecting Discord needs an SSE website account with {data.email}.</p>
		{:else if data.discord.username && !form?.discordDisconnected}
			<p>Discord account <strong>{data.discord.username}</strong> is connected to your SSE profile.</p>
			<form method="POST" action="?/disconnectDiscord">
				<button class="secondary">Disconnect Discord</button>
			</form>
		{:else}
			<p>Sign in with Discord to connect it to your SSE profile. We save your Discord profile, its email, and the accounts you've connected on Discord, and may give you server roles later.</p>
			<a class="button" href="/account/discord" data-sveltekit-reload>Connect Discord</a>
		{/if}
		{#if form?.discordDisconnected}<p role="status">Discord disconnected.</p>
		{:else if discordMessage}<p class={page.url.searchParams.get('discord') === 'connected' ? '' : 'error'} role="status">{discordMessage}</p>{/if}
	</div>
{/if}

<div class="card">
	<h2>Birthday</h2>
	{#if data.birthday}
		<p>Saved for extra rewards: {data.birthday.month}/{data.birthday.day}. It can't be changed. You can remove it.</p>
		<form method="POST" action="?/removeBirthday"><button class="quiet">Remove my birthday</button></form>
	{:else if data.birthdayRemoved}
		<p>You removed your birthday, so it can't be added back.</p>
	{:else}
		<form method="POST" action="?/birthday" class="birthday-form">
			<BirthdayFields />
			<button class="quiet">Save birthday</button>
		</form>
	{/if}
	{#if form?.birthdayError}<p class="error" role="alert">{form.birthdayError}</p>{/if}
	{#if form?.birthdaySaved}<p role="status">Saved.</p>{/if}
</div>

<div class="card">
	<TakeBreak action="?/break" until={data.until} error={form?.breakError} />
</div>

<style>
	/* Same card as the sign-in pages. */
	.card {
		max-width: 400px;
		margin: 24px auto;
		background: var(--card);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 24px 20px;
		display: grid;
		gap: 16px;
	}
	h1 {
		margin: 0;
		font-size: 1.375rem;
	}
	p {
		margin: 0;
		color: var(--fg-2);
	}
	form,
	label {
		display: grid;
		gap: 12px;
	}
	label {
		gap: 6px;
		font-size: 0.875rem;
		color: var(--fg-2);
	}
	input {
		height: 48px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--fg);
		font: inherit;
		font-size: 1rem;
	}
	button,
	.button {
		display: grid;
		place-items: center;
		text-decoration: none;
		height: 48px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: #fff;
		font: inherit;
		font-weight: var(--weight-strong);
		cursor: pointer;
	}
	.secondary {
		background: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
		width: 100%;
	}
	.error {
		color: var(--no-text);
		font-size: 0.875rem;
	}
</style>
