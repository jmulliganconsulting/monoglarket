<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · Monoglarket</title></svelte:head>

<h1>Sign in</h1>
{#if form?.error}
	<p class="error" role="alert">{form.error}</p>
	<p><a href="/login">Back to sign in</a></p>
{:else}
	<p>Tap the button to finish signing in on this device.</p>
	<form method="POST">
		<input type="hidden" name="token" value={data.token} />
		<button>Sign in</button>
	</form>
{/if}
