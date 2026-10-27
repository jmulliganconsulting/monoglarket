// Admins add or remove dabloons from a member's balance (vault "Balance adjustments"). Every adjustment is a ledger transaction
// against the house account, so the books still balance. The private reason stays with admins; the public one can be shown to the member.
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, postTransaction } from '../ledger/ledger.ts';
import { audit } from '../audit/audit.ts';
import { UserError } from './users.ts';

export const MAX_ADJUSTMENT = 1_000_000;

/** amount: signed whole dabloons (+ adds, − removes). key: one per form, so a double submit adds once. */
export async function adjustBalance(
  prisma: PrismaClient,
  r: { adminId: number; userId: number; currencyId: number; amount: number; reasonPrivate: string; reasonPublic: string; key: string },
) {
  if (!Number.isSafeInteger(r.amount) || r.amount === 0 || Math.abs(r.amount) > MAX_ADJUSTMENT) throw new UserError('bad_adjust_amount');
  const reasonPrivate = r.reasonPrivate.trim();
  const reasonPublic = r.reasonPublic.trim();
  if (reasonPrivate.length < 5) throw new UserError('reason_required');
  if (reasonPublic.length > 280) throw new UserError('public_reason_long');
  return withTx(prisma, async (db) => {
    const currency = await db.currency.findUnique({ where: { id: r.currencyId }, select: { id: true, code: true, kind: true } });
    if (!currency || currency.kind !== 'internal') throw new UserError('bad_currency');
    const user = await db.user.findUnique({ where: { id: r.userId }, select: { id: true, displayName: true } });
    if (!user) throw new UserError('no_member');

    const idempotencyKey = `adjust:${r.key}`;
    const prior = await db.balanceAdjustment.findFirst({ where: { transaction: { idempotencyKey } } });
    if (prior) return prior;

    // Adds come from the house; removals go back to it. A removal can't take the member below zero (the ledger enforces that).
    const transactionId = await postTransaction(db, {
      kind: 'adjustment',
      currencyId: currency.id,
      idempotencyKey,
      memo: reasonPublic || undefined,
      entries: [
        { accountId: await account(db, 'user', r.userId, currency.id), amount: r.amount },
        { accountId: await account(db, 'house', 0, currency.id), amount: -r.amount },
      ],
    });
    const adjustment = await db.balanceAdjustment.create({
      data: { userId: r.userId, currencyId: currency.id, amount: r.amount, actorId: r.adminId, reasonPrivate, reasonPublic: reasonPublic || null, transactionId },
    });
    await audit(db, r.adminId, 'adjust_balance', null, `user ${r.userId}: ${r.amount > 0 ? '+' : ''}${r.amount} ${currency.code}. Private: ${reasonPrivate}`);
    return adjustment;
  });
}
