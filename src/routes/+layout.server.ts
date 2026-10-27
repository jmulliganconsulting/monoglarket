import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../auth/roles.ts';
import { visitSummary } from '../summary/summary.ts';

export async function load({ locals }) {
	const user = locals.user;
	const onboarded = !!user?.onboardedAt;
	// Members an admin has trusted with a market get the Resolve page (vault "Auth and roles").
	const trusted = user && onboarded ? await prisma.marketResolver.count({ where: { userId: user.id } }) : 0;
	// Visit summary: shown after a sign-in while it has something to show (vault "Visit summary").
	let summary = null;
	if (user?.summarySince) {
		summary = await visitSummary(prisma, user.id, user.summarySince);
		if (!summary) await prisma.user.update({ where: { id: user.id }, data: { summarySince: null } });
	}
	const unread = user && onboarded ? await prisma.notification.count({ where: { userId: user.id, readAt: null } }) : 0;
	// The member's dabloon balance, shown in the navbar on every screen.
	const coins = user ? await prisma.account.findFirst({ where: { ownerType: 'user', ownerId: user.id, currency: { kind: 'internal', active: true } }, select: { balance: true, currency: { select: { code: true } } } }) : null;
	return {
		unread,
		coins: coins?.balance ?? 0,
		coinCode: coins?.currency.code ?? '',
		user: user && { displayName: user.displayName },
		onboarded,
		canModerate: !!user && isModerator(user.role),
		isAdmin: user?.role === 'admin',
		canResolve: trusted > 0,
		summary: summary && { since: summary.since, currencies: summary.currencies },
	};
}
