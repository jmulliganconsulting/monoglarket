import { prisma } from '#lib/server/db.ts';
import { floorCoins, floorShares, proceedsForSell } from '../../engine/lmsr.ts';
import { netOfFee } from '../../engine/fees.ts';

export async function load({ locals }) {
	const userId = locals.user!.id;
	const [accounts, positions, trades] = await Promise.all([
		prisma.account.findMany({ where: { ownerType: 'user', ownerId: userId }, select: { balance: true, currency: { select: { code: true, name: true } } } }),
		prisma.position.findMany({
			where: { userId, shares: { gt: 0 } },
			include: { outcome: { select: { id: true, label: true } }, market: { include: { currency: { select: { code: true } }, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, q: true } } } } },
		}),
		prisma.trade.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
			take: 50,
			include: { market: { select: { id: true, question: true, currency: { select: { code: true } } } }, outcome: { select: { label: true } } },
		}),
	]);

	// What the position is worth now: the dabloons a sale would bring after the early-sale fee, or the payout if it has been decided.
	const worth = (p: (typeof positions)[number]) => {
		const m = p.market;
		const shares = p.shares.toNumber();
		if (m.status === 'resolved' || m.status === 'final') return m.resolvedOutcomeId === p.outcomeId ? floorCoins(shares) : 0;
		if (m.status !== 'open' && m.status !== 'closed') return 0;
		const i = m.outcomes.findIndex((o) => o.id === p.outcomeId);
		return netOfFee(floorCoins(proceedsForSell(m.outcomes.map((o) => o.q.toNumber()), m.b, i, floorShares(shares))));
	};

	// Public reasons only: the private reason never leaves the admin panel (vault "Balance adjustments").
	const adjustments = await prisma.balanceAdjustment.findMany({ where: { userId, reasonPublic: { not: null } }, orderBy: { createdAt: 'desc' }, take: 20, include: { currency: { select: { code: true } } } });
	return {
		adjustments: adjustments.map((a) => ({ id: a.id, amount: a.amount, code: a.currency.code, reason: a.reasonPublic, createdAt: a.createdAt })),
		balances: accounts.map((a) => ({ code: a.currency.code, name: a.currency.name, balance: a.balance })),
		positions: positions.map((p) => ({
			marketId: p.market.id,
			question: p.market.question,
			currency: p.market.currency.code,
			status: p.market.status,
			outcome: p.outcome.label,
			shares: p.shares.toNumber(),
			netSpent: p.netSpent,
			worth: worth(p),
		})),
		trades: trades.map((t) => ({
			id: t.id,
			marketId: t.market.id,
			question: t.market.question,
			currency: t.market.currency.code,
			outcome: t.outcome.label,
			shares: t.shares.toNumber(),
			amount: t.amount,
			createdAt: t.createdAt,
		})),
	};
}
