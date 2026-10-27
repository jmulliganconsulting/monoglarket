// In-app alerts (FR-20, FR-24): holders hear about resolution and disputes, closing notices and overdue reminders go once.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, buy, createMarket, grant, resolve } from '../markets/markets.ts';
import { fileReport } from '../reports/reports.ts';
import { runNotifications } from './notify.ts';
import { testSource } from '../resolvers/resolvers.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator', onboardedAt: new Date() } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator', onboardedAt: new Date() } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator', onboardedAt: new Date() } })).id;
  for (const id of [mod, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('holders hear about a result and a dispute; non-holders hear nothing', async () => {
  const marketId = await createMarket(pool, { question: 'Win?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: inDays(5) });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const [yes] = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 20, minShares: 0, idempotencyKey: 'n1' });
  await resolve(pool, { marketId, outcomeId: yes, moderatorId: mod });
  assert.equal(await pool.notification.count({ where: { userId: ana, kind: 'resolved', marketId } }), 1);
  assert.equal(await pool.notification.count({ where: { userId: ben, marketId } }), 0);
  await fileReport(pool, { reporterId: ben, kind: 'resolution', marketId, body: 'That result is wrong' });
  assert.equal(await pool.notification.count({ where: { userId: ana, kind: 'disputed', marketId } }), 1);
});

test('a closing notice goes once; the overdue reminder reaches moderators, not members', async () => {
  const soon = await createMarket(pool, { question: 'Soon?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: new Date(Date.now() + 3 * 3600_000) });
  await approveMarket(pool, { marketId: soon, moderatorId: mod });
  const [yes] = (await pool.outcome.findMany({ where: { marketId: soon }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  await buy(pool, { userId: ben, marketId: soon, outcomeId: yes, spend: 10, minShares: 0, idempotencyKey: 'n2' });
  await runNotifications(pool);
  await runNotifications(pool);
  assert.equal(await pool.notification.count({ where: { userId: ben, kind: 'closing', marketId: soon } }), 1);

  const late = await createMarket(pool, { question: 'Late?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: inDays(2) });
  await approveMarket(pool, { marketId: late, moderatorId: mod });
  await pool.market.update({ where: { id: late }, data: { status: 'closed', closeAt: new Date(Date.now() - 2 * 86_400_000) } });
  await runNotifications(pool);
  await runNotifications(pool);
  assert.equal(await pool.notification.count({ where: { userId: mod, kind: 'overdue', marketId: late } }), 1);
  assert.equal(await pool.notification.count({ where: { userId: ana, kind: 'overdue', marketId: late } }), 0);
});

test('Test now asks the source and writes nothing', async () => {
  const marketId = await createMarket(pool, { question: 'Source?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: inDays(5) });
  await approveMarket(pool, { marketId, moderatorId: mod });
  await pool.market.update({ where: { id: marketId }, data: { resolverSource: 'fake' } });
  const fake = { fake: { label: 'Fake', check: async () => ({ status: 'proposal' as const, outcome: 'Yes', evidence: 'says yes' }) } };
  const r = await testSource(pool, marketId, fake);
  assert.equal(r.ok, true);
  assert.ok(r.message.includes('Yes'));
  assert.equal(await pool.resolutionProposal.count({ where: { marketId } }), 0);
});
