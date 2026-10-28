<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Look · {data.question} · Monoglarket</title></svelte:head>

<h1>Look of the market</h1>
<p class="meta">{data.question}</p>
{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<form method="POST" enctype="multipart/form-data">
	<fieldset>
		<legend>Market</legend>
		<label>Primary colour <input type="color" name="colorPrimary" value={data.colorPrimary ?? '#4c8bf5'} /></label>
		<label>Secondary colour <input type="color" name="colorSecondary" value={data.colorSecondary ?? '#e8844c'} /></label>
		<label>Picture for the list (PNG, JPEG or WebP, 2 MB)
			<input type="file" name="image" accept="image/png,image/jpeg,image/webp" />
		</label>
		{#if data.imageFile}<img class="thumb" src="/market-images/{data.imageFile}" alt="" />{/if}
	</fieldset>

	{#each data.outcomes as o (o.id)}
		<fieldset>
			<legend>{o.label}</legend>
			<input type="hidden" name="outcomeId" value={o.id} />
			<!-- Yes/No always draw in the house blue/pink, so no picker (and the saved colour is cleared). -->
			{#if !['yes', 'no'].includes(o.label.trim().toLowerCase())}<label>Colour in the graph <input type="color" name="color_{o.id}" value={o.color ?? '#888888'} /></label>{/if}
			<label>Picture
				<input type="file" name="image_{o.id}" accept="image/png,image/jpeg,image/webp" />
			</label>
			{#if o.imageFile}<img class="thumb" src="/market-images/{o.imageFile}" alt="" />{/if}
		</fieldset>
	{/each}

	<button class="go">Save look</button>
</form>

<style>
	.meta {
		color: var(--muted);
		margin: 0 0 16px;
	}
	form {
		display: grid;
		gap: 16px;
		max-width: 560px;
	}
	fieldset {
		display: grid;
		gap: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		padding: 12px 16px;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	.thumb {
		width: 96px;
		height: 96px;
		object-fit: cover;
		border-radius: 12px;
	}
	.go {
		font: inherit;
		min-height: 44px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--fg);
		color: var(--bg);
		font-weight: var(--weight-strong);
		justify-self: start;
		padding: 0 20px;
		cursor: pointer;
	}
	.error {
		color: var(--no-text);
	}
</style>
