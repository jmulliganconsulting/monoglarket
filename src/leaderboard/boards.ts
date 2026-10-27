// Leaderboard boards (vault "Leaderboard"): each board ranks the same members by a different number.
import type { PrismaClient } from '../db/db.ts';
import { leaderboard } from './leaderboard.ts';

export const BOARDS = {
  worth: { label: 'Most currency', unit: (c: string) => c },
  won: { label: 'Most money won', unit: (c: string) => `${c} profit` },
  best: { label: 'Best single call', unit: (c: string) => `${c} on one market` },
  wins: { label: 'Most markets won', unit: () => 'markets' },
  traded: { label: 'Most markets traded', unit: () => 'markets' },
  trades: { label: 'Most trades', unit: () => 'trades' },
  season: { label: 'Season profit', unit: (c: string) => `${c} this season` },
} as const;
export type BoardKey = keyof typeof BOARDS;

// Profit comes from these kinds: trades, payouts, refunds and changes of result. Grants, allowances and earnings don't count.
const PROFIT_KINDS = ['trade', 'payout', 'payout_reversal', 'refund'];

export async function board(prisma: PrismaClient, currencyId: number, key: BoardKey, season?: Date) {
  const members = await prisma.user.findMany({ where: { onboardedAt: { not: null } }, select: { id: true, displayName: true, preferredName: true, username: true } });
  const values = new Map<number, number>();

  if (key === 'worth') {
    const rows = await leaderboard(prisma, currencyId);
    for (const r of rows) values.set(r.id, r.netWorth);
  } else if (key === 'won' || key === 'best' || key === 'season') {
    const since = key === 'season' ? season : undefined;
    if (key === 'season' && !since) return { label: BOARDS.season.label, rows: [] };
    const entries = await prisma.ledgerEntry.findMany({
      where: { account: { ownerType: 'user', currencyId }, transaction: { kind: { in: PROFIT_KINDS }, ...(since ? { createdAt: { gte: since } } : {}) } },
      select: { amount: true, account: { select: { ownerId: true } }, transaction: { select: { marketId: true } } },
    });
    if (key === 'best') {
      // Best call: the most profit one member made on a single market.
      const perMarket = new Map<string, { user: number; sum: number }>();
      for (const e of entries) {
        const k = `${e.account.ownerId}:${e.transaction.marketId ?? 0}`;
        const cur = perMarket.get(k) ?? { user: e.account.ownerId, sum: 0 };
        cur.sum += e.amount;
        perMarket.set(k, cur);
      }
      for (const { user, sum } of perMarket.values()) values.set(user, Math.max(values.get(user) ?? 0, sum));
    } else {
      for (const e of entries) values.set(e.account.ownerId, (values.get(e.account.ownerId) ?? 0) + e.amount);
    }
  } else if (key === 'wins') {
    const won = await prisma.position.findMany({
      where: { shares: { gt: 0 }, market: { currencyId, status: { in: ['resolved', 'final'] } } },
      select: { userId: true, outcomeId: true, market: { select: { resolvedOutcomeId: true } } },
    });
    for (const p of won) if (p.outcomeId === p.market.resolvedOutcomeId) values.set(p.userId, (values.get(p.userId) ?? 0) + 1);
  } else if (key === 'traded') {
    const rows = await prisma.position.groupBy({ by: ['userId'], where: { market: { currencyId } }, _count: { _all: true } });
    for (const r of rows) values.set(r.userId, r._count._all);
  } else {
    const rows = await prisma.trade.groupBy({ by: ['userId'], where: { market: { currencyId } }, _count: { _all: true } });
    for (const r of rows) values.set(r.userId, r._count._all);
  }

  const ranked = members
    .map((m) => ({ id: m.id, name: m.preferredName ?? m.displayName, username: m.username, value: values.get(m.id) ?? 0 }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((r, i) => ({ rank: i + 1, ...r }));
  return { label: BOARDS[key].label, rows: ranked };
}
