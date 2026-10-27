// Resolution modes (vault ADR-012, FR-25): 'manual' takes no source, 'auto_confirm' waits for a moderator,
// 'auto' makes the source's answer final at once and only an admin can approve a market that way.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { SOURCES } from '../resolvers/sources.ts';
import { approveMarket, createMarket, grant, proposeFromResolver } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, admin: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const SOURCE = 'test-weather';

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  for (const id of [mod, admin]) await grant(pool, id, coin, 1000, `g:${id}`);
  // A stub source for the tests only. Real sources are written in code, one per trusted domain.
  SOURCES[SOURCE] = { label: 'Test weather', check: async () => ({ kind: 'not_yet' }) } as never;
});
after(async () => {
  delete SOURCES[SOURCE];
  await drop();
});

/** An open market with the stub source attached, then closed, so the resolver job can answer it. */
async function closedWithSource() {
  const marketId = await createMarket(pool, { question: 'Rain on the day?', criteria: 'Weather service', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  await pool.market.update({ where: { id: marketId }, data: { resolverSource: SOURCE, status: 'closed' } });
  return marketId;
}

test('a market with no source is manual, and its mode says so', async () => {
  const marketId = await createMarket(pool, { question: 'Snow?', criteria: 'Count', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).resolutionMode, 'manual');
});

test('auto_confirm: the source proposes, and a moderator decides', async () => {
  const marketId = await closedWithSource();
  await pool.market.update({ where: { id: marketId }, data: { resolutionMode: 'auto_confirm' } });
  const yes = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 0 } })).id;
  const p = await proposeFromResolver(pool, { marketId, outcomeId: yes, evidence: 'Source says yes' });
  assert.equal(p?.status, 'pending');
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status, 'closed');
});

test('auto: the source answer is the result at once, with no moderator', async () => {
  const marketId = await closedWithSource();
  await pool.market.update({ where: { id: marketId }, data: { resolutionMode: 'auto' } });
  const yes = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 0 } })).id;
  await proposeFromResolver(pool, { marketId, outcomeId: yes, evidence: 'Source says yes' });
  const m = await pool.market.findUniqueOrThrow({ where: { id: marketId } });
  assert.equal(m.status, 'resolved');
  assert.equal(m.resolvedOutcomeId, yes);
  assert.equal(m.resolvedBy, null);
  const p = await pool.resolutionProposal.findFirstOrThrow({ where: { marketId, source: 'resolver' } });
  assert.equal(p.status, 'accepted');
});

test('only an admin can approve a market in auto mode; a moderator is refused', async () => {
  const marketId = await createMarket(pool, { question: 'Fog?', criteria: 'Count', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await assert.rejects(approveMarket(pool, { marketId, moderatorId: mod, resolverSource: SOURCE, resolutionMode: 'auto' }), { code: 'auto_needs_admin' });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status, 'pending_review');
  await approveMarket(pool, { marketId, moderatorId: admin, resolverSource: SOURCE, resolutionMode: 'auto' });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).resolutionMode, 'auto');
});

test('a source approved without a mode is confirmed by a moderator, not made final', async () => {
  const marketId = await createMarket(pool, { question: 'Hail?', criteria: 'Count', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod, resolverSource: SOURCE });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).resolutionMode, 'auto_confirm');
});
