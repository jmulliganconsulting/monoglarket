// Breaks, admin-granted resolvers, and automatic-source proposals (vault "Take a break", "Resolving markets").
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { SOURCES } from '../resolvers/sources.ts';
import { runResolvers } from '../resolvers/resolvers.ts';
import { acceptProposal, approveMarket, buy, createMarket, grant, grantResolver, lockMarket, propose, resolve, revokeResolver, runMarketJobs, scheduleLock } from './markets.ts';
import { endBreak, startBreak } from '../users/users.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number;
let admin: number, mod: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const later = () => new Date(Date.now() + 2 * 86_400_000);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  const mk = async (displayName: string, role: string) => (await pool.user.create({ data: { displayName, role } })).id;
  admin = await mk('Admin', 'admin');
  mod = await mk('Mod', 'moderator');
  ana = await mk('Ana', 'creator');
  ben = await mk('Ben', 'creator');
  for (const id of [admin, mod, ana, ben]) await grant(pool, id, coin, 1000, `grant:${id}`);
});
after(() => drop());

async function openMarket(resolverSource: string | null = null) {
  const marketId = await createMarket(pool, { question: 'Win regionals?', criteria: 'Official results page', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 10000 });
  await approveMarket(pool, { marketId, moderatorId: mod, resolverSource });
  const outcomes = await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' }, select: { id: true } });
  return { marketId, yes: outcomes[0].id, no: outcomes[1].id };
}
const status = async (marketId: number) => (await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status;

test('a member on a break cannot trade, request a resolution or create a market; a break only extends; an admin can end it', async () => {
  const m = await openMarket();
  await startBreak(pool, ben, 'week');
  await assert.rejects(buy(pool, { userId: ben, marketId: m.marketId, outcomeId: m.yes, spend: 10, minShares: 0, idempotencyKey: 'brk1' }), { code: 'on_break' });
  await assert.rejects(propose(pool, { marketId: m.marketId, outcomeId: m.yes, proposerId: ben, evidence: 'looks like it' }), { code: 'on_break' });
  await assert.rejects(createMarket(pool, { question: 'Q?', criteria: 'C', currencyId: coin, outcomes: ['A', 'B'], subsidy: 10, closeAt: tomorrow(), creatorId: ben }), { code: 'on_break' });

  const until = (await pool.user.findUniqueOrThrow({ where: { id: ben } })).breakUntil;
  await startBreak(pool, ben, 'day');
  assert.deepEqual((await pool.user.findUniqueOrThrow({ where: { id: ben } })).breakUntil, until);

  await endBreak(pool, admin, ben);
  await buy(pool, { userId: ben, marketId: m.marketId, outcomeId: m.yes, spend: 10, minShares: 0, idempotencyKey: 'brk2' });
});

test('a break does not stop payouts: a member holding a winner is still paid while on break', async () => {
  const m = await openMarket();
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 50, minShares: 0, idempotencyKey: 'pay1' });
  await startBreak(pool, ana, 'month');
  const before = await withTx(pool, async (db) => balance(db, await account(db, 'user', ana, coin)));
  await propose(pool, { marketId: m.marketId, outcomeId: m.yes, proposerId: admin, evidence: 'Official results page' });
  const after = await withTx(pool, async (db) => balance(db, await account(db, 'user', ana, coin)));
  assert.ok(after > before);
  await endBreak(pool, admin, ana);
});

test('an admin grants one member one market: they resolve it alone, on that market only, until revoked', async () => {
  const m1 = await openMarket();
  const m2 = await openMarket();
  await grantResolver(pool, { marketId: m1.marketId, userId: ben, adminId: admin });

  // Not granted on m2, so ben's suggestion is refused outright: members never queue a suggested result.
  await assert.rejects(propose(pool, { marketId: m2.marketId, outcomeId: m2.yes, proposerId: ben, evidence: 'my guess' }), { code: 'not_allowed' });

  const p = await propose(pool, { marketId: m1.marketId, outcomeId: m1.no, proposerId: ben, evidence: 'Results page says No' });
  assert.equal(p.status, 'accepted');
  assert.equal(await status(m1.marketId), 'resolved');

  const m3 = await openMarket();
  await grantResolver(pool, { marketId: m3.marketId, userId: ben, adminId: admin });
  const grant3 = await pool.marketResolver.findFirstOrThrow({ where: { marketId: m3.marketId, userId: ben } });
  await revokeResolver(pool, { grantId: grant3.id, adminId: admin });
  // Once revoked, ben is an ordinary member again, so the suggestion is refused rather than queued.
  await assert.rejects(propose(pool, { marketId: m3.marketId, outcomeId: m3.yes, proposerId: ben, evidence: 'Results page' }), { code: 'not_allowed' });
});

test('a granted resolver who holds a position in the market cannot resolve it', async () => {
  const m = await openMarket();
  await grantResolver(pool, { marketId: m.marketId, userId: ana, adminId: admin });
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 10, minShares: 0, idempotencyKey: 'coi1' });
  await assert.rejects(propose(pool, { marketId: m.marketId, outcomeId: m.no, proposerId: ana, evidence: 'Results page' }), { code: 'conflict_of_interest' });
  assert.equal(await status(m.marketId), 'open');
});

test('a source must be registered before a market can use it', async () => {
  const marketId = await createMarket(pool, { question: 'Q?', criteria: 'C', currencyId: coin, outcomes: ['A', 'B'], subsidy: 10, closeAt: tomorrow() });
  await assert.rejects(approveMarket(pool, { marketId, moderatorId: mod, resolverSource: 'nobody' }), { code: 'bad_resolver' });
});

test('an automatic source proposes once for a closed market; a moderator confirms and the winners are paid', async () => {
  SOURCES.fake = { label: 'Fake scoreboard', check: async () => ({ status: 'proposal', outcome: 'Yes', evidence: 'Scoreboard showed Yes' }) };
  try {
    const m = await openMarket('fake');
    await buy(pool, { userId: ben, marketId: m.marketId, outcomeId: m.yes, spend: 20, minShares: 0, idempotencyKey: 'src1' });
    assert.equal((await runMarketJobs(pool, later())).closed >= 1, true);
    assert.equal(await status(m.marketId), 'closed');

    assert.deepEqual(await runResolvers(pool), { checked: 1, proposed: 1 });
    assert.deepEqual(await runResolvers(pool), { checked: 1, proposed: 0 }); // same answer already waiting

    const waiting = await pool.resolutionProposal.findFirstOrThrow({ where: { marketId: m.marketId, status: 'pending' } });
    assert.equal(waiting.source, 'resolver');
    assert.equal(waiting.proposerId, null);
    await acceptProposal(pool, { proposalId: waiting.id, moderatorId: mod });
    assert.equal(await status(m.marketId), 'resolved');
  } finally {
    delete SOURCES.fake;
  }
});

test('a source answer naming no outcome is reported and not proposed', async () => {
  SOURCES.odd = { label: 'Odd', check: async () => ({ status: 'proposal', outcome: 'Maybe', evidence: 'x' }) };
  try {
    const m = await openMarket('odd');
    await pool.market.update({ where: { id: m.marketId }, data: { status: 'closed' } });
    assert.deepEqual(await runResolvers(pool, { odd: SOURCES.odd }), { checked: 1, proposed: 0 });
    assert.equal(await pool.resolutionProposal.count({ where: { marketId: m.marketId } }), 0);
  } finally {
    delete SOURCES.odd;
  }
});

test('a moderator locks trading by hand; it stays locked until the market is resolved', async () => {
  const m = await openMarket();
  await lockMarket(pool, { marketId: m.marketId, moderatorId: mod });
  await assert.rejects(lockMarket(pool, { marketId: m.marketId, moderatorId: mod }), { code: 'already_locked' });
  await assert.rejects(buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 10, minShares: 0, idempotencyKey: 'lock1' }), { code: 'market_locked' });
  await resolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod });
  assert.equal(await status(m.marketId), 'resolved');
});

test('a scheduled lock fires once in the job and then stays locked', async () => {
  const m = await openMarket();
  const lockAt = new Date(Date.now() + 3_600_000);
  await scheduleLock(pool, { marketId: m.marketId, moderatorId: mod, lockAt });
  await runMarketJobs(pool, new Date(Date.now() + 7_200_000));
  const row = await pool.market.findUniqueOrThrow({ where: { id: m.marketId } });
  assert.ok(row.lockedAt);
  assert.equal(row.lockAt, null);
  await assert.rejects(buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 10, minShares: 0, idempotencyKey: 'sched1' }), { code: 'market_locked' });
  assert.ok((await pool.market.findUniqueOrThrow({ where: { id: m.marketId } })).lockedAt);
});

test('a lock time must be in the future and before the market closes', async () => {
  const m = await openMarket();
  await assert.rejects(scheduleLock(pool, { marketId: m.marketId, moderatorId: mod, lockAt: new Date(Date.now() - 1000) }), { code: 'bad_lock_time' });
  await assert.rejects(scheduleLock(pool, { marketId: m.marketId, moderatorId: mod, lockAt: new Date(Date.now() + 2 * 86_400_000) }), { code: 'bad_lock_time' });
});
