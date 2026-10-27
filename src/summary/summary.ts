// The visit summary (vault "Visit summary"): what changed in a member's balances since they last signed in.
// Built from the ledger, so it always matches the balance. Winnings, losses, earnings and backpay are all here.
import type { PrismaClient } from '../db/db.ts';

export type SummaryItem = { at: Date; text: string; amount: number };
export type CurrencySummary = { code: string; name: string; net: number; items: SummaryItem[]; won: { question: string; shares: number }[]; lost: { question: string; amount: number }[] };
export type VisitSummary = { since: Date; currencies: CurrencySummary[] };

export async function visitSummary(prisma: PrismaClient, userId: number, since: Date): Promise<VisitSummary | null> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { account: { ownerType: 'user', ownerId: userId }, transaction: { createdAt: { gt: since } } },
    select: {
      amount: true,
      account: { select: { currency: { select: { code: true, name: true } } } },
      transaction: {
        select: {
          kind: true,
          memo: true,
          marketId: true,
          createdAt: true,
          trade: { select: { shares: true, outcome: { select: { label: true } }, market: { select: { question: true } } } },
        },
      },
    },
    orderBy: { transaction: { createdAt: 'asc' } },
  });
  const marketIds = [...new Set(entries.map((e) => e.transaction.marketId).filter((id): id is number => id !== null))];
  const questions = new Map((await prisma.market.findMany({ where: { id: { in: marketIds } }, select: { id: true, question: true } })).map((m) => [m.id, m.question]));

  // One line per transaction: the member's net amount in it.
  const byTx = new Map<string, { code: string; name: string; at: Date; kind: string; memo: string | null; question: string | null; trade: (typeof entries)[number]['transaction']['trade']; amount: number }>();
  for (const e of entries) {
    const key = `${e.account.currency.code}:${e.transaction.createdAt.getTime()}:${e.transaction.kind}:${e.transaction.memo ?? ''}:${e.transaction.marketId ?? ''}:${e.transaction.trade?.shares ?? ''}`;
    const row = byTx.get(key) ?? {
      code: e.account.currency.code,
      name: e.account.currency.name,
      at: e.transaction.createdAt,
      kind: e.transaction.kind,
      memo: e.transaction.memo,
      question: e.transaction.marketId ? (questions.get(e.transaction.marketId) ?? null) : null,
      trade: e.transaction.trade,
      amount: 0,
    };
    row.amount += e.amount;
    byTx.set(key, row);
  }

  const byCurrency = new Map<string, CurrencySummary>();
  const currencyOf = (code: string, name: string) => {
    if (!byCurrency.has(code)) byCurrency.set(code, { code, name, net: 0, items: [], won: [], lost: [] });
    return byCurrency.get(code)!;
  };
  for (const r of byTx.values()) {
    if (r.amount === 0) continue;
    const c = currencyOf(r.code, r.name);
    c.net += r.amount;
    c.items.push({ at: r.at, text: describe(r), amount: r.amount });
  }

  // Decided markets since then: what the member held at the end.
  const positions = await prisma.position.findMany({
    where: { userId, shares: { gt: 0 }, market: { status: { in: ['resolved', 'final'] }, resolvedAt: { gt: since } } },
    select: { shares: true, netSpent: true, outcomeId: true, market: { select: { question: true, resolvedOutcomeId: true, currency: { select: { code: true, name: true } } } } },
  });
  for (const p of positions) {
    const c = currencyOf(p.market.currency.code, p.market.currency.name);
    if (p.outcomeId === p.market.resolvedOutcomeId) c.won.push({ question: p.market.question, shares: p.shares.toNumber() });
    else c.lost.push({ question: p.market.question, amount: Math.max(0, p.netSpent) });
  }

  const currencies = [...byCurrency.values()].filter((c) => c.items.length || c.won.length || c.lost.length);
  return currencies.length ? { since, currencies } : null;
}

export function describe(r: { kind: string; memo: string | null; question: string | null; trade: { shares: { toNumber(): number }; outcome: { label: string }; market: { question: string } } | null }) {
  if (r.trade) {
    const shares = r.trade.shares.toNumber();
    const verb = shares > 0 ? 'Bought' : 'Sold';
    return `${verb} ${Math.abs(shares).toFixed(2)} “${r.trade.outcome.label}” in ${r.trade.market.question}`;
  }
  if (r.kind === 'payout') return `Paid out on ${r.question ?? 'a market'}`;
  if (r.kind === 'payout_reversal') return `Result changed: ${r.question ?? 'a market'}`;
  if (r.kind === 'refund') return r.memo ? `Refund on ${r.question ?? 'a market'}: ${r.memo}` : `Refund on ${r.question ?? 'a market'}`;
  if (r.kind === 'grant') return r.memo ?? ` granted`;
  // An admin's change: the memo holds only the public reason, never the private one.
  if (r.kind === 'adjustment') return r.memo ?? 'Your balance was adjusted by an administrator';
  if (r.kind === 'earn') return r.memo ?? 'Earned';
  return r.memo ?? r.kind;
}
