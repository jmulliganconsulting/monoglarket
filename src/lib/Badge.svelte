<script lang="ts">
	// One badge (vault "How badges are drawn"). Full: pill with icon and label. Compact: icon-only chip, label on hover and for screen readers.
	import { IconArrowsExchange, IconBackpack, IconBook, IconBulb, IconGavel, IconIdBadge2, IconSchool, IconSettings, IconShield } from '@tabler/icons-svelte';
	import type { Badge } from '../badges/badges.ts';

	let { badge, compact = false }: { badge: Badge; compact?: boolean } = $props();
	const ICON = {
		settings: IconSettings,
		gavel: IconGavel,
		school: IconSchool,
		shield: IconShield,
		bulb: IconBulb,
		'id-badge-2': IconIdBadge2,
		backpack: IconBackpack,
		book: IconBook,
		transfer: IconArrowsExchange,
	};
	const Icon = $derived(badge.icon ? ICON[badge.icon as keyof typeof ICON] : undefined);
</script>

{#if compact}
	<span class="chip" class:outline={badge.outline} class:filled={!!badge.colour} style:background={badge.colour} title={badge.label} role="img" aria-label={badge.label}>
		{#if Icon}<Icon size={14} stroke={2} aria-hidden="true" />{/if}
	</span>
{:else}
	<span class="pill" class:outline={badge.outline} class:filled={!!badge.colour} style:background={badge.colour}>
		{#if Icon}<Icon size={16} stroke={2} aria-hidden="true" />{/if}
		{badge.label}
	</span>
{/if}

<style>
	.chip,
	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		background: var(--card-2);
		color: var(--fg);
		font-size: 0.875rem;
		font-weight: var(--weight-strong);
	}
	.chip {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		flex: none;
	}
	.pill {
		border-radius: var(--radius-pill);
		padding: 6px 14px;
	}
	/* Solid role colour: near-black text and icon, the same in both themes. */
	.filled {
		color: #000;
	}
	.outline {
		background: transparent;
		color: var(--muted);
		box-shadow: inset 0 0 0 1px var(--muted);
	}
</style>
