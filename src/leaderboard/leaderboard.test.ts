// Net worth = wallet + open positions at current prices. Decided markets are excluded: winnings are already in the wallet.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, buy, createMarket, grant, resolve } from '../markets/markets.ts';
import { leaderboard } from './leaderboard.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number;
let mod: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator', onboardedAt: new Date() } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator', onboardedAt: new Date() } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator', onboardedAt: new Date() } })).id;
  await pool.user.create({ data: { displayName: 'Not yet onboarded', role: 'creator' } });
  for (const id of [mod, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('ranks by wallet plus open positions, excludes decided markets, lists only onboarded members', async () => {
  const marketId = await createMarket(pool, { question: 'Q?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 10000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const [yes] = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 100, minShares: 0, idempotencyKey: 'lb1' });

  const rows = await leaderboard(pool, coin);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, ana);
  assert.equal(rows[0].wallet, 900);
  assert.ok(rows[0].holdings > 0); // value at the new price, not the 100 dabloons spent
  assert.equal(rows[0].netWorth, rows[0].wallet + rows[0].holdings);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);

  await resolve(pool, { marketId, outcomeId: yes, moderatorId: mod });
  const after = (await leaderboard(pool, coin)).find((r) => r.id === ana)!;
  assert.equal(after.holdings, 0); // resolved: the winnings are in the wallet now
  assert.equal(after.netWorth, after.wallet);
  assert.ok(after.wallet > 900);
});

test('season profit counts trades since the season started, not grants', async () => {
  const { seasonProfit } = await import('./leaderboard.ts');
  const since = new Date();
  await new Promise((r) => setTimeout(r, 5));
  const marketId = await createMarket(pool, { question: 'Season?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 10000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const [yes] = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 100, minShares: 0, idempotencyKey: 'season1' });
  const profit = await seasonProfit(pool, coin, since);
  assert.equal(profit.get(ana), -100); // the spend, before any result
  assert.equal(profit.get(mod) ?? 0, 0);
});
