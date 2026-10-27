// Weekly allowance (FR-15): once a week per member, and running the job again pays nothing more.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { account, balance } from '../ledger/ledger.ts';
import { withTx } from '../db/db.ts';
import { runAllowance, weekKey } from './allowance.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, ana: number, newbie: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal', weeklyAllowance: 50 } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator', onboardedAt: new Date() } })).id;
  newbie = (await pool.user.create({ data: { displayName: 'New', role: 'creator' } })).id; // not onboarded: no allowance
});
after(() => drop());

test('weeks start on Monday (UTC)', () => {
  assert.equal(weekKey(new Date('2026-10-27T12:00:00Z')), '2026-10-26'); // a Tuesday
  assert.equal(weekKey(new Date('2026-10-26T00:00:00Z')), '2026-10-26'); // the Monday itself
  assert.equal(weekKey(new Date('2026-10-25T23:59:00Z')), '2026-10-19'); // the Sunday before
});

test('each onboarded member is paid the allowance once a week; running again pays nothing', async () => {
  const first = await runAllowance(pool, new Date('2026-10-27T12:00:00Z'));
  assert.equal(first.paid, 1);
  const again = await runAllowance(pool, new Date('2026-10-28T08:00:00Z'));
  assert.equal(again.paid, 0);
  const next = await runAllowance(pool, new Date('2026-11-02T08:00:00Z'));
  assert.equal(next.paid, 1);
  const bal = await withTx(pool, async (db) => balance(db, await account(db, 'user', ana, coin)));
  assert.equal(bal, 100);
  assert.equal(await pool.account.count({ where: { ownerType: 'user', ownerId: newbie } }), 0);
});
