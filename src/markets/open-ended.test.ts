// A market with no set close date trades until a moderator closes or resolves it; the scheduled close never touches it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, buy, createMarket, grant, runMarketJobs } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'COIN', name: 'Coins', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  for (const id of [mod, ana]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('a market with no close date stays open for trading, and the scheduled close leaves it alone', async () => {
  const marketId = await createMarket(pool, { question: 'Open ended?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: null, creatorId: ana });
  await approveMarket(pool, { marketId, moderatorId: mod });
  await runMarketJobs(pool, new Date(Date.now() + 365 * 86_400_000));
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status, 'open');
  const outcome = await pool.outcome.findFirstOrThrow({ where: { marketId, label: 'Yes' } });
  await buy(pool, { userId: ana, marketId, outcomeId: outcome.id, spend: 5, minShares: 0, idempotencyKey: 'open-ended-buy' });
});
