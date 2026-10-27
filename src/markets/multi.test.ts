// Multiple-choice markets (FR-12): 3 to 10 outcomes trade, price and resolve like yes/no, with exactly one winner.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { prices } from '../engine/lmsr.ts';
import { approveMarket, buy, createMarket, grant, resolve } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number, cy: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator' } })).id;
  cy = (await pool.user.create({ data: { displayName: 'Cy', role: 'creator' } })).id;
  for (const id of [mod, ana, ben, cy]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

const base = { question: 'Bake sale: how many come?', criteria: 'Head count by the organiser', currencyId: 0, subsidy: 110, closeAt: tomorrow(), spendCap: 100000 };

test('outcome count is 2 to 10: a single choice or an eleventh option is refused', async () => {
  await assert.rejects(createMarket(pool, { ...base, currencyId: coin, outcomes: ['Only one'] }), { code: 'bad_outcome_count' });
  await assert.rejects(createMarket(pool, { ...base, currencyId: coin, outcomes: Array.from({ length: 11 }, (_, i) => `O${i}`) }), { code: 'bad_outcome_count' });
});

test('a four-way market prices to one, takes trades on every option, and pays only the winner', async () => {
  const marketId = await createMarket(pool, { ...base, currencyId: coin, outcomes: ['Under 30', '30–60', '60–90', 'Over 90'] });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const ids = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  const p = prices(new Array(4).fill(0), (await pool.market.findUniqueOrThrow({ where: { id: marketId } })).b);
  assert.ok(Math.abs(p.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(p.every((x) => Math.abs(x - 0.25) < 1e-9)); // an even start

  await buy(pool, { userId: ana, marketId, outcomeId: ids[1], spend: 100, minShares: 0, idempotencyKey: 'm1' });
  await buy(pool, { userId: ben, marketId, outcomeId: ids[2], spend: 100, minShares: 0, idempotencyKey: 'm2' });
  const q = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.q.toNumber());
  const now = prices(q, (await pool.market.findUniqueOrThrow({ where: { id: marketId } })).b);
  assert.ok(Math.abs(now.reduce((s, x) => s + x, 0) - 1) < 1e-9); // still one in total after trading

  const anaBefore = await wallet(ana);
  const benBefore = await wallet(ben);
  await resolve(pool, { marketId, outcomeId: ids[1], moderatorId: mod });
  assert.ok((await wallet(ana)) > anaBefore); // holder of the winning option is paid
  assert.equal(await wallet(ben), benBefore); // a loser gets nothing back
  assert.deepEqual(await withTx(pool, checkLedger), []);
  assert.equal(await wallet(cy), 1000);
});
