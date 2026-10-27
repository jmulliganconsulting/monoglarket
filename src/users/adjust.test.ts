// Admin balance adjustments (vault "Balance adjustments"): the books still balance, the reasons stay where they belong,
// and a double submit adds once.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { grant } from '../markets/markets.ts';
import { visitSummary } from '../summary/summary.ts';
import { adjustBalance } from './adjust.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, admin: number, ana: number;
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  await grant(pool, ana, coin, 1000, 'g:ana');
});
after(() => drop());

const base = { adminId: 0, userId: 0, currencyId: 0, reasonPrivate: 'Prize from the bake sale', reasonPublic: 'Bake sale prize', key: '' };

test('adding and removing dabloons moves the balance and keeps the ledger balanced', async () => {
  await adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: 50, key: 'k1' });
  assert.equal(await wallet(ana), 1050);
  await adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: -200, reasonPublic: '', key: 'k2' });
  assert.equal(await wallet(ana), 850);
  assert.deepEqual(await withTx(pool, checkLedger), []);
});

test('the same key twice adds once; a removal below zero is refused; a short private reason is refused', async () => {
  await adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: 10, key: 'dup' });
  await adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: 10, key: 'dup' });
  assert.equal(await wallet(ana), 860);
  await assert.rejects(adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: -999999, key: 'k3' }), { code: 'insufficient_balance' });
  await assert.rejects(adjustBalance(pool, { ...base, adminId: admin, userId: ana, currencyId: coin, amount: 5, reasonPrivate: 'no', key: 'k4' }), { code: 'reason_required' });
});

test('the member sees the public reason and never the private one', async () => {
  const row = await pool.balanceAdjustment.findFirstOrThrow({ where: { userId: ana, amount: 50 } });
  assert.equal(row.reasonPrivate, 'Prize from the bake sale');
  const summary = await visitSummary(pool, ana, new Date(Date.now() - 3_600_000));
  const text = JSON.stringify(summary);
  assert.ok(text.includes('Bake sale prize'));
  assert.ok(!text.includes('Prize from the bake sale'));
});
