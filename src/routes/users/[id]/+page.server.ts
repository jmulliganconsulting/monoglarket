import { error } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { achievements, schoolBadges, seniorityBadge, standingLabel, statusBadges } from '../../../badges/badges.ts';
import { sseMemberForEmail } from '../../../sse/accounts.ts';

// Public profile (vault "Signup and profile", "Status badges"). Shows what other members can see: no legal names, birth date or email.
export async function load({ params, locals }) {
	const id = Number(params.id);
	const u = await prisma.user.findUnique({ where: { id }, include: { programs: { orderBy: { sort: 'asc' } } } });
	if (!u || !u.onboardedAt) error(404, 'No such member');

	const [member, earned, positions, trades, marketsTraded] = await Promise.all([
		u.email ? sseMemberForEmail(prisma, u.email) : null,
		achievements(prisma, id),
		prisma.position.findMany({
			where: { userId: id, shares: { gt: 0 }, market: { status: { in: ['open', 'closed', 'resolved', 'final'] } } },
			include: { market: { select: { id: true, question: true, status: true } }, outcome: { select: { label: true } } },
		}),
		prisma.trade.findMany({
			where: { userId: id },
			orderBy: { createdAt: 'desc' },
			take: 20,
			include: { market: { select: { id: true, question: true, currency: { select: { code: true } } } }, outcome: { select: { label: true } } },
		}),
		prisma.position.findMany({ where: { userId: id }, distinct: ['marketId'], select: { marketId: true } }),
	]);

	const seniority = standingLabel(u);
	return {
		name: u.preferredName ?? u.displayName,
		username: u.username,
		pronouns: u.pronounsPublic ? u.pronouns : null,
		joined: u.createdAt,
		isYou: locals.user?.id === id,
		image: member?.imageFile ?? null,
		// Line one: official positions, seniority, school. Line two: site roles, then achievements. The page splits by group.
		badges: [
			...statusBadges(u, member),
			...(seniorityBadge(u) ? [seniorityBadge(u)!] : []),
			...schoolBadges(u, u.programs),
			...earned,
		],
		seniority,
		stats: { trades: await prisma.trade.count({ where: { userId: id } }), markets: marketsTraded.length },
		positions: positions.map((p) => ({ marketId: p.market.id, question: p.market.question, status: p.market.status, outcome: p.outcome.label, shares: p.shares.toNumber() })),
		trades: trades.map((t) => ({ id: t.id, marketId: t.market.id, question: t.market.question, currency: t.market.currency.code, outcome: t.outcome.label, shares: t.shares.toNumber(), amount: t.amount, createdAt: t.createdAt })),
	};
}
