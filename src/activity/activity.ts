// A member's own record (vault "Activity"): every market they've traded, with what they put in and what came back,
// and every ledger transaction on their accounts, from signup grants and allowances to admin adjustments.
import type { PrismaClient } from '../db/db.ts';
import { describe } from '../summary/summary.ts';

const PROFIT_KINDS = ['trade', 'payout', 'payout_reversal', 'refund'];

export async function marketActivity(prisma: PrismaClient, userId: number) {
  const positions = await prisma.position.findMany({
    where: { userId },
    orderBy: { marketId: 'desc' },
    include: {
      outcome: { select: { label: true, id: true } },
      market: { select: { id: true, question: true, status: true, resolvedOutcomeId: true, currency: { select: { code: true } } } },
    },
  });
  const profit = new Map<number, number>();
  const rows = await prisma.ledgerEntry.findMany({
    where: { account: { ownerType: 'user', ownerId: userId }, transaction: { marketId: { not: null }, kind: { in: PROFIT_KINDS } } },
    select: { amount: true, transaction: { select: { marketId: true } } },
  });
  for (const r of rows) profit.set(r.transaction.marketId!, (profit.get(r.transaction.marketId!) ?? 0) + r.amount);

  const byMarket = new Map<number, { marketId: number; question: string; status: string; currency: string; held: string[]; stake: number; profit: number; result: string }>();
  for (const p of positions) {
    const m = p.market;
    const row = byMarket.get(m.id) ?? { marketId: m.id, question: m.question, status: m.status, currency: m.currency.code, held: [], stake: 0, profit: profit.get(m.id) ?? 0, result: '' };
    row.stake += p.netSpent;
    if (p.shares.toNumber() > 0) row.held.push(`${p.shares.toNumber().toFixed(2)} “${p.outcome.label}”`);
    byMarket.set(m.id, row);
  }
  const won = new Map(positions.map((p) => [`${p.marketId}:${p.outcomeId}`, p.market.resolvedOutcomeId === p.outcomeId]));
  for (const row of byMarket.values()) {
    if (row.status === 'cancelled') row.result = 'Refunded';
    else if (row.status === 'resolved' || row.status === 'final') {
      const heldWinner = positions.some((p) => p.marketId === row.marketId && p.shares.toNumber() > 0 && won.get(`${p.marketId}:${p.outcomeId}`));
      row.result = heldWinner ? 'Won' : 'Lost';
    } else row.result = 'Open';
  }
  return [...byMarket.values()];
}

export async function transactions(prisma: PrismaClient, userId: number, take = 300) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { account: { ownerType: 'user', ownerId: userId } },
    orderBy: { transaction: { createdAt: 'desc' } },
    take,
    select: {
      amount: true,
      account: { select: { currency: { select: { code: true } } } },
      transaction: { select: { kind: true, memo: true, marketId: true, createdAt: true, trade: { select: { shares: true, outcome: { select: { label: true } }, market: { select: { question: true } } } } } },
    },
  });
  const ids = [...new Set(entries.map((e) => e.transaction.marketId).filter((x): x is number => x !== null))];
  const questions = new Map((await prisma.market.findMany({ where: { id: { in: ids } }, select: { id: true, question: true } })).map((m) => [m.id, m.question]));
  return entries.map((e) => ({
    at: e.transaction.createdAt,
    currency: e.account.currency.code,
    amount: e.amount,
    kind: e.transaction.kind,
    text: describe({ kind: e.transaction.kind, memo: e.transaction.memo, question: e.transaction.marketId ? (questions.get(e.transaction.marketId) ?? null) : null, trade: e.transaction.trade }),
  }));
}
