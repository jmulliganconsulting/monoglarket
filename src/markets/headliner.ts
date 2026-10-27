// A category tab's headliner (vault "Categories and visuals"): the moderator's pick, else the market with the most trades in the last 24 h.
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { MarketError } from './markets.ts';

const DAY_MS = 86_400_000;

/** `markets` must be in closing order: a tie in trades goes to the one that closes first (so no trades = the soonest). */
export function pickHeadliner(markets: { id: number; headliner: boolean }[], trades: Map<number, number>): number | null {
  const picked = markets.find((m) => m.headliner);
  if (picked) return picked.id;
  let best: number | null = null;
  let bestTrades = -1;
  for (const m of markets) {
    const n = trades.get(m.id) ?? 0;
    if (n > bestTrades) [best, bestTrades] = [m.id, n];
  }
  return best;
}

/** Trades in the last 24 hours, per market (the same window as Trending). */
export async function recentTrades(prisma: PrismaClient, marketIds: number[]): Promise<Map<number, number>> {
  const rows = await prisma.trade.groupBy({ by: ['marketId'], where: { marketId: { in: marketIds }, createdAt: { gt: new Date(Date.now() - DAY_MS) } }, _count: true });
  return new Map(rows.map((r) => [r.marketId, r._count]));
}

/** A moderator makes one open market the headliner of its category. The previous pick in that category is cleared. */
export async function setHeadliner(prisma: PrismaClient, r: { marketId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const market = await db.market.findUnique({ where: { id: r.marketId }, select: { id: true, categoryId: true, status: true } });
    if (!market || market.categoryId === null) throw new MarketError('not_found');
    if (market.status !== 'open' && market.status !== 'closed') throw new MarketError('not_editable');
    await db.market.updateMany({ where: { categoryId: market.categoryId, headliner: true }, data: { headliner: false } });
    await db.market.update({ where: { id: market.id }, data: { headliner: true } });
    await audit(db, r.moderatorId, 'headliner', market.id, '');
  });
}
