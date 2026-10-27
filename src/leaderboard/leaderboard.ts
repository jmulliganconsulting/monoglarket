// Leaderboard per currency (vault "Screens: Leaderboard", "Data model": net worth = wallet + value of open positions).
// Only open and closed markets count for holdings: a resolved or final market's winnings are already in the wallet.
import type { PrismaClient } from '../db/db.ts';
import { prices } from '../engine/lmsr.ts';

/** Profit this season (FR-14): trades, payouts, refunds and changes of result since the season started. Grants and earnings don't count. */
export async function seasonProfit(prisma: PrismaClient, currencyId: number, since: Date) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { account: { ownerType: 'user', currencyId }, transaction: { createdAt: { gte: since }, kind: { in: ['trade', 'payout', 'payout_reversal', 'refund'] } } },
    select: { amount: true, account: { select: { ownerId: true } } },
  });
  const profit = new Map<number, number>();
  for (const r of rows) profit.set(r.account.ownerId, (profit.get(r.account.ownerId) ?? 0) + r.amount);
  return profit;
}

export async function leaderboard(prisma: PrismaClient, currencyId: number, season?: Date) {
  const [accounts, positions, members, profit] = await Promise.all([
    prisma.account.findMany({ where: { ownerType: 'user', currencyId }, select: { ownerId: true, balance: true } }),
    prisma.position.findMany({
      where: { shares: { gt: 0 }, market: { currencyId, status: { in: ['open', 'closed'] } } },
      select: {
        userId: true,
        outcomeId: true,
        shares: true,
        market: { select: { id: true, b: true, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, q: true } } } },
      },
    }),
    prisma.user.findMany({ where: { onboardedAt: { not: null } }, select: { id: true, displayName: true, preferredName: true, username: true } }),
    season ? seasonProfit(prisma, currencyId, season) : Promise.resolve(null),
  ]);

  const wallet = new Map(accounts.map((a) => [a.ownerId, a.balance]));
  const holdings = new Map<number, number>();
  for (const p of positions) {
    const q = p.market.outcomes.map((o) => o.q.toNumber());
    const i = p.market.outcomes.findIndex((o) => o.id === p.outcomeId);
    holdings.set(p.userId, (holdings.get(p.userId) ?? 0) + prices(q, p.market.b)[i] * p.shares.toNumber());
  }

  return members
    .map((m) => {
      const coins = wallet.get(m.id) ?? 0;
      const held = Math.floor(holdings.get(m.id) ?? 0); // whole dabloons, rounded down, as payouts are
      return { id: m.id, name: m.preferredName ?? m.displayName, username: m.username, wallet: coins, holdings: held, netWorth: coins + held, profit: profit ? (profit.get(m.id) ?? 0) : null };
    })
    .sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name))
    .map((row, i) => ({ rank: i + 1, ...row }));
}
