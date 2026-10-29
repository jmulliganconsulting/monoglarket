<script lang="ts">
	// One badge (vault "How badges are drawn"). Full: pill with icon and label. Compact: icon-only chip, label on hover and for screen readers.
	import { IconArrowsExchange, IconBackpack, IconBook, IconBulb, IconGavel, IconIdBadge2, IconBriefcase, IconBuilding, IconChalkboard, IconCrown, IconSchool, IconSettings, IconShield, IconStairs } from '@tabler/icons-svelte';
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
		crown: IconCrown,
		building: IconBuilding,
		stairs: IconStairs,
		briefcase: IconBriefcase,
		chalkboard: IconChalkboard,
	};
	const ring = $derived(badge.ring ? `inset 0 0 0 0.5px ${badge.ring}` : undefined);
	const Icon = $derived(badge.icon ? ICON[badge.icon as keyof typeof ICON] : undefined);
	// Solid role colour: near-black text and icon, the same in both themes. Outline: transparent with a muted ring.
	const tone = $derived(badge.outline ? 'bg-transparent text-muted shadow-[inset_0_0_0_1px_var(--muted)]' : badge.colour ? 'text-black' : 'bg-card-2 text-fg');
	const base = 'inline-flex items-center justify-center gap-1.5 text-sm font-strong';
</script>

{#if compact}
	<span class="{base} {tone} size-6 flex-none rounded-full" style:background={badge.colour} style:box-shadow={ring} title={badge.label} role="img" aria-label={badge.label}>
		{#if Icon}<Icon size={14} stroke={2} aria-hidden="true" />{/if}
	</span>
{:else}
	<span class="{base} {tone} rounded-pill px-3.5 py-1.5" style:background={badge.colour} style:box-shadow={ring}>
		{#if Icon}<Icon size={16} stroke={2} aria-hidden="true" />{/if}
		{badge.label}
	</span>
{/if}

