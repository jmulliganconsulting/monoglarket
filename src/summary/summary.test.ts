// The visit summary is built from the ledger: winnings, losses and every change since the given time (vault "Visit summary").
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, buy, createMarket, grant, resolve } from '../markets/markets.ts';
import { visitSummary } from './summary.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator' } })).id;
  for (const id of [mod, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('a visit summary shows the net change, a win, a loss and every transaction since the last visit', async () => {
  await new Promise((r) => setTimeout(r, 5)); // the grants above are older than this
  const since = new Date();
  const marketId = await createMarket(pool, { question: 'Win regionals?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 10000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const [yes, no] = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 100, minShares: 0, idempotencyKey: 'vs1' });
  await buy(pool, { userId: ben, marketId, outcomeId: no, spend: 50, minShares: 0, idempotencyKey: 'vs2' });
  await resolve(pool, { marketId, outcomeId: yes, moderatorId: mod });

  const anaSummary = await visitSummary(pool, ana, since);
  const coinAna = anaSummary!.currencies[0];
  assert.equal(coinAna.code, 'DBLN');
  assert.equal(coinAna.items.length, 2); // the buy and the payout
  assert.equal(coinAna.net, coinAna.items.reduce((s, i) => s + i.amount, 0));
  assert.ok(coinAna.net > 0); // paid out more than the 100 spent
  assert.equal(coinAna.won.length, 1);
  assert.equal(coinAna.lost.length, 0);

  const benSummary = await visitSummary(pool, ben, since);
  assert.equal(benSummary!.currencies[0].net, -50);
  assert.equal(benSummary!.currencies[0].lost[0].amount, 50);
  assert.equal(benSummary!.currencies[0].won.length, 0);
});

test('nothing since the last visit means no summary', async () => {
  assert.equal(await visitSummary(pool, ana, new Date()), null);
});
