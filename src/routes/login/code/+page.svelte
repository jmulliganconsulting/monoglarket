<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Enter code · Monoglarket</title></svelte:head>

<h1>Check your email</h1>
<p>We sent a code to <strong>{data.email}</strong>. Type it here, or tap the link in the email.</p>

<form method="POST" action="?/verify">
	<label>
		6-digit code
		<!-- one-time-code lets iPhone and Android offer the code from the email/keyboard -->
		<input class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required />
	</label>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	{#if form?.resent}<p role="status">New code sent.</p>{/if}
	<button>Sign in</button>
</form>

<form method="POST" action="?/resend">
	<button class="link">Send a new code</button>
</form>
<p><a href="/login">Use a different email</a></p>
