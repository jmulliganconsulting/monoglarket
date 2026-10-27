// The only code allowed to move dabloons. Design: vault note "Ledger" (ADR-003).
import { Prisma, type Db } from '../db/db.ts';

export type OwnerType = 'user' | 'market' | 'house' | 'mint' | 'bridge' | 'earn';
export type Entry = { accountId: number; amount: number };

export class LedgerError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

/** Get or create the (owner, currency) account. House/mint/bridge use ownerId 0; earn uses EARN_SOURCES (src/earn/earn.ts). */
export async function account(db: Db, ownerType: OwnerType, ownerId: number, currencyId: number): Promise<number> {
  const key = { ownerType_ownerId_currencyId: { ownerType, ownerId, currencyId } };
  const found = await db.account.findUnique({ where: key, select: { id: true } });
  if (found) return found.id;
  const currency = await db.currency.findUnique({ where: { id: currencyId } });
  if (!currency) throw new LedgerError('unknown_currency');
  // mint and earn are where internal dabloons come from and bridge mirrors dabloons held outside, so all go negative by design
  const allowNegative = ownerType === 'mint' || ownerType === 'earn' || ownerType === 'bridge' || (ownerType === 'house' && currency.kind === 'internal');
  const created = await db.account.upsert({ where: key, create: { ownerType, ownerId, currencyId, allowNegative }, update: {}, select: { id: true } });
  return created.id;
}

export async function balance(db: Db, accountId: number): Promise<number> {
  return (await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true } })).balance;
}

/**
 * Post a balanced transaction inside the caller's db transaction. Returns the transaction id.
 * Overdrafts are refused here, not by a DB constraint, so the check works on any database (ADR-014).
 */
export async function postTransaction(
  db: Db,
  tx: { kind: string; currencyId: number; idempotencyKey: string; marketId?: number; memo?: string; entries: Entry[] },
): Promise<number> {
  const entries = tx.entries.filter((e) => e.amount !== 0);
  if (entries.length < 2) throw new LedgerError('too_few_entries');
  for (const e of entries) if (!Number.isSafeInteger(e.amount)) throw new LedgerError('non_integer_amount', String(e.amount));
  if (entries.reduce((s, e) => s + e.amount, 0) !== 0) throw new LedgerError('unbalanced');

  let id: number;
  try {
    ({ id } = await db.ledgerTransaction.create({
      data: { kind: tx.kind, currencyId: tx.currencyId, idempotencyKey: tx.idempotencyKey, marketId: tx.marketId, memo: tx.memo, entries: { create: entries } },
      select: { id: true },
    }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new LedgerError('duplicate_idempotency_key');
    throw e;
  }
  for (const e of entries) {
    // a debit only applies if the account may go negative or has enough; one atomic UPDATE ... WHERE
    // Only a payout reversal may take a wallet below zero: winnings already spent become a debt paid from future winnings.
    const guard = e.amount < 0 && tx.kind !== 'payout_reversal' ? { OR: [{ allowNegative: true }, { balance: { gte: -e.amount } }] } : {};
    const r = await db.account.updateMany({ where: { id: e.accountId, currencyId: tx.currencyId, ...guard }, data: { balance: { increment: e.amount } } });
    if (r.count !== 1) {
      const sameCurrency = await db.account.count({ where: { id: e.accountId, currencyId: tx.currencyId } });
      throw new LedgerError(sameCurrency ? 'insufficient_balance' : 'currency_mismatch');
    }
  }
  return id;
}

/** Ledger invariants (NFR-01). Empty array = healthy. Loads whole tables: fine at club scale, nightly. */
export async function checkLedger(db: Db): Promise<string[]> {
  const problems: string[] = [];

  for (const c of await db.account.groupBy({ by: ['currencyId'], _sum: { balance: true } }))
    if (c._sum.balance) problems.push(`currency ${c.currencyId} sums to ${c._sum.balance}`);

  const sums = new Map((await db.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amount: true } })).map((r) => [r.accountId, r._sum.amount ?? 0]));
  for (const a of await db.account.findMany({ select: { id: true, balance: true } }))
    if (a.balance !== (sums.get(a.id) ?? 0)) problems.push(`account ${a.id} balance ${a.balance} != entries ${sums.get(a.id) ?? 0}`);

  // every live market's pool can pay out whichever outcome wins
  const live = await db.market.findMany({ where: { status: { in: ['open', 'closed'] } }, select: { id: true, currencyId: true, positions: { select: { outcomeId: true, shares: true } } } });
  for (const m of live) {
    const payout = new Map<number, number>();
    for (const p of m.positions) payout.set(p.outcomeId, (payout.get(p.outcomeId) ?? 0) + Math.floor(p.shares.toNumber()));
    const need = Math.max(0, ...payout.values());
    const pool = await db.account.findUnique({ where: { ownerType_ownerId_currencyId: { ownerType: 'market', ownerId: m.id, currencyId: m.currencyId } } });
    if ((pool?.balance ?? 0) < need) problems.push(`market ${m.id} pool ${pool?.balance ?? 0} < possible payout ${need}`);
  }
  return problems;
}
