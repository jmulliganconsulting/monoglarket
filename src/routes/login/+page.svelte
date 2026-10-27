<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// A form result means they posted from the email view, so stay on it.
	const showEmail = $derived(data.showEmail || !!form);
</script>

<svelte:head><title>Sign in · Club Predictions</title></svelte:head>

<h1>Sign in</h1>

{#if !showEmail}
	<a class="google" href="/login/google" data-sveltekit-reload>Sign in with Google</a>
	{#if data.error}<p class="error" role="alert">{data.error}</p>{/if}
	<a class="small" href="/login?email">Sign in with email + code</a>
{:else}
	<p>We'll email you a 6-digit code and a sign-in link.</p>
	<form method="POST" action="?/email">
		<label>
			School email
			<input name="email" type="email" autocomplete="email" inputmode="email" required value={form?.email ?? ''} />
		</label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button>Email me a code</button>
	</form>

	<p>Set a password on your account page? Use it here.</p>
	<form method="POST" action="?/password">
		<label>
			Email
			<input name="email" type="email" autocomplete="username" inputmode="email" required value={form?.email ?? ''} />
		</label>
		<label>
			Password
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		{#if form?.passwordError}<p class="error" role="alert">{form.passwordError}</p>{/if}
		<button>Sign in with password</button>
	</form>
	{#if data.google}<a class="small" href="/login">Back to Google sign-in</a>{/if}
{/if}

<style>
	.google {
		height: 56px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: #fff;
		font-size: 1.0625rem;
		font-weight: var(--weight-strong);
		text-decoration: none;
	}
	.small {
		justify-self: center;
		padding: 12px;
		font-size: 0.875rem;
		color: var(--fg-2);
	}
</style>
