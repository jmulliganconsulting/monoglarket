// Weekly allowance (FR-15): every onboarded member gets an internal currency's allowance once a week (Monday, UTC).
// Each payment has its own idempotency key, so the hourly job can run any number of times and pay once.
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, postTransaction } from '../ledger/ledger.ts';
import { audit } from '../audit/audit.ts';

/** The Monday (UTC) that starts the week containing `now`, as YYYY-MM-DD. */
export function weekKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function runAllowance(prisma: PrismaClient, now = new Date()) {
  const currencies = await prisma.currency.findMany({ where: { kind: 'internal', active: true, weeklyAllowance: { gt: 0 } } });
  const members = await prisma.user.findMany({ where: { onboardedAt: { not: null } }, select: { id: true } });
  const week = weekKey(now);
  let paid = 0;
  for (const c of currencies)
    for (const m of members) {
      const key = `allowance:${m.id}:${c.id}:${week}`;
      if (await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) continue;
      try {
        await withTx(prisma, async (db) =>
          postTransaction(db, {
            kind: 'grant',
            currencyId: c.id,
            idempotencyKey: key,
            memo: 'Weekly allowance',
            entries: [
              { accountId: await account(db, 'mint', 0, c.id), amount: -c.weeklyAllowance },
              { accountId: await account(db, 'user', m.id, c.id), amount: c.weeklyAllowance },
            ],
          }),
        );
        paid++;
      } catch (e) {
        console.error(`Allowance failed for member ${m.id}: ${(e as Error).message}`);
      }
    }
  await audit(prisma, null, 'allowance_run', null, `${paid} paid for week ${week}`);
  return { paid, week };
}
