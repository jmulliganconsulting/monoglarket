import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RetryableConflict, withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { acceptProposal, approveMarket, buy, cancel, createMarket, finalise, grant, openMarket, propose, rejectMarket, rejectProposal, resolve, runMarketJobs, sell } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number;
const users: number[] = [];
const moderator = { id: 0 };
const tomorrow = () => new Date(Date.now() + 86_400_000);
const open = (m: Omit<Parameters<typeof openMarket>[1], 'moderatorId'>) => openMarket(pool, { ...m, moderatorId: moderator.id });

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Mod']) {
    const { id } = await pool.user.create({ data: { displayName: name, role: name === 'Mod' ? 'moderator' : 'creator' } });
    if (name === 'Mod') moderator.id = id;
    else users.push(id);
    await grant(pool, id, coin, 1000, `grant:${id}`);
  }
});
after(() => drop());

const ledgerOk = async () => assert.deepEqual(await withTx(pool, checkLedger), []);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));

test('buy, sell, slippage, overdraft, idempotency', async () => {
  const { marketId, outcomeIds } = await open({ question: 'Win regionals?', criteria: 'Official results page', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 10000 });
  const [yes] = outcomeIds;
  const [ana] = users;

  const t = await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 10, minShares: 19, idempotencyKey: 'k1' });
  assert.ok(Number(t.shares) > 19 && t.probAfter > 0.5);
  assert.equal(await wallet(ana), 990);

  // same key again = same trade, no double charge
  const again = await buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 10, minShares: 0, idempotencyKey: 'k1' });
  assert.equal(again.id, t.id);
  assert.equal(await wallet(ana), 990);

  await assert.rejects(buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 10, minShares: 100, idempotencyKey: 'k2' }), { code: 'price_moved' });
  await assert.rejects(buy(pool, { userId: ana, marketId, outcomeId: yes, spend: 5000, minShares: 0, idempotencyKey: 'k3' }), { code: 'insufficient_balance' });
  await assert.rejects(sell(pool, { userId: ana, marketId, outcomeId: yes, shares: 1000, minProceeds: 0, idempotencyKey: 'k4' }), { code: 'not_enough_shares' });

  // Selling back pays the early-sale fee (ADR-021): about 9 dabloons gross, so 8 or 9 after the fee.
  const s = await sell(pool, { userId: ana, marketId, outcomeId: yes, shares: Number(t.shares), minProceeds: 8, idempotencyKey: 'k5' });
  assert.ok(Number(s.amount) >= 8 && Number(s.amount) <= 9); // rounding favours the house
  assert.ok(s.fee > 0);
  await ledgerOk();
});

test('moderator with a position cannot resolve', async () => {
  const { marketId, outcomeIds } = await open({ question: 'Snow?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow() });
  await buy(pool, { userId: moderator.id, marketId, outcomeId: outcomeIds[0], spend: 5, minShares: 0, idempotencyKey: 'mod-buy' });
  await assert.rejects(resolve(pool, { marketId, outcomeId: outcomeIds[0], moderatorId: moderator.id }), { code: 'conflict_of_interest' });
});

test('admin with a position can resolve, for testing', async () => {
  const admin = await pool.user.create({ data: { displayName: 'Tester', role: 'admin' } });
  await grant(pool, admin.id, coin, 1000, `g:${admin.id}`);
  const { marketId, outcomeIds } = await open({ question: 'Test snow?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow() });
  await buy(pool, { userId: admin.id, marketId, outcomeId: outcomeIds[0], spend: 5, minShares: 0, idempotencyKey: 'admin-buy' });
  await resolve(pool, { marketId, outcomeId: outcomeIds[0], moderatorId: admin.id });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status, 'resolved');
});

test('simulation: 1000 random trades across 3 markets, then resolve/cancel; ledger always balances', async () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const houseBefore = await withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)));
  const markets = [
    await open({ question: 'A', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 100, closeAt: tomorrow() }),
    await open({ question: 'B', criteria: 'x', currencyId: coin, outcomes: ['1', '2', '3', '4'], subsidy: 150, closeAt: tomorrow() }),
    await open({ question: 'C', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 50, closeAt: tomorrow(), spendCap: 200 }),
  ];
  const expected = new Set(['insufficient_balance', 'not_enough_shares', 'position_cap', 'too_small', 'bad_amount']);

  for (let n = 0; n < 1000; n++) {
    const m = markets[Math.floor(rand() * markets.length)];
    const outcomeId = m.outcomeIds[Math.floor(rand() * m.outcomeIds.length)];
    const userId = users[Math.floor(rand() * users.length)];
    const key = `sim:${n}`;
    try {
      if (rand() < 0.65) await buy(pool, { userId, marketId: m.marketId, outcomeId, spend: 1 + Math.floor(rand() * 60), minShares: 0, idempotencyKey: key });
      else {
        const held = (await pool.position.findUnique({ where: { userId_outcomeId: { userId, outcomeId } } }))?.shares.toNumber() ?? 0;
        await sell(pool, { userId, marketId: m.marketId, outcomeId, shares: held * rand(), minProceeds: 0, idempotencyKey: key });
      }
    } catch (e: any) {
      if (!expected.has(e.code)) throw e;
    }
    if (n % 100 === 99) await ledgerOk();
  }

  const filled = await pool.trade.count({ where: { marketId: { in: markets.map((m) => m.marketId) } } });
  assert.ok(filled > 600, `only ${filled} trades filled`);

  await resolve(pool, { marketId: markets[0].marketId, outcomeId: markets[0].outcomeIds[0], moderatorId: moderator.id });
  await resolve(pool, { marketId: markets[1].marketId, outcomeId: markets[1].outcomeIds[2], moderatorId: moderator.id });
  await cancel(pool, { marketId: markets[2].marketId, moderatorId: moderator.id });
  await ledgerOk();
  await finalise(pool, markets[0].marketId);
  await finalise(pool, markets[1].marketId);
  await ledgerOk();

  // house lost at most the subsidies of the two resolved markets (cancel can cost a little more, bounded by trading)
  const houseAfter = await withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)));
  assert.ok(houseBefore - houseAfter <= 100 + 150 + 50, `house lost ${houseBefore - houseAfter}`);
  for (const m of markets) {
    const pool_ = await withTx(pool, async (db) => balance(db, await account(db, 'market', m.marketId, coin)));
    assert.equal(pool_, 0);
  }
});

test('concurrent buys on one market serialise via the version check', async () => {
  const { marketId, outcomeIds } = await open({ question: 'Race?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow() });
  const results = await Promise.allSettled(
    users.map((userId, n) => buy(pool, { userId, marketId, outcomeId: outcomeIds[n % 2], spend: 20, minShares: 0, idempotencyKey: `race:${n}` })),
  );
  for (const r of results) if (r.status === 'rejected') assert.ok(r.reason instanceof RetryableConflict, String(r.reason));
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  // q on each outcome must equal the sum of its filled trades: no lost updates
  for (const outcomeId of outcomeIds) {
    const o = await pool.outcome.findUniqueOrThrow({ where: { id: outcomeId } });
    const sum = (await pool.trade.aggregate({ where: { outcomeId }, _sum: { shares: true } }))._sum.shares?.toNumber() ?? 0;
    assert.equal(o.q.toNumber(), sum);
  }
  await ledgerOk();
});

test('lifecycle: propose, reject, approve funds the pool, accept a proposal and pay out', async () => {
  const [ana, ben] = users;
  const id = await createMarket(pool, { question: 'Picnic outside?', criteria: 'Weather report', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 60, closeAt: tomorrow(), creatorId: ana });
  const [yes, no] = (await pool.outcome.findMany({ where: { marketId: id }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  const status = async (marketId: number) => (await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status;

  // pending markets take no money and no trades
  assert.equal(await status(id), 'pending_review');
  await assert.rejects(buy(pool, { userId: ben, marketId: id, outcomeId: yes, spend: 5, minShares: 0, idempotencyKey: 'pend-buy' }), { code: 'market_closed' });

  // approve: the house funds the subsidy, trading opens
  const houseBefore = await withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)));
  await approveMarket(pool, { marketId: id, moderatorId: moderator.id });
  assert.equal(await status(id), 'open');
  assert.equal(await withTx(pool, async (db) => balance(db, await account(db, 'market', id, coin))), 60);
  assert.equal(houseBefore - (await withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)))), 60);
  await buy(pool, { userId: ben, marketId: id, outcomeId: yes, spend: 20, minShares: 0, idempotencyKey: 'life-buy' });

  // proposals need evidence; a newer one supersedes the older
  await assert.rejects(propose(pool, { marketId: id, outcomeId: yes, proposerId: ben, evidence: '  ' }), { code: 'evidence_required' });
  // A moderator's proposal needs a different moderator to accept it.
  const secondModerator = (await pool.user.create({ data: { displayName: 'Mod Two', role: 'moderator' } })).id;
  // Members can't propose a result (vault "Resolution and payouts"), so the proposals come from moderators.
  await assert.rejects(propose(pool, { marketId: id, outcomeId: no, proposerId: ben, evidence: 'Forecast says rain' }), { code: 'not_allowed' });
  const first = await propose(pool, { marketId: id, outcomeId: no, proposerId: moderator.id, evidence: 'Forecast says rain' });
  const second = await propose(pool, { marketId: id, outcomeId: yes, proposerId: moderator.id, evidence: 'Sunny at 2pm, per the met office' });
  assert.equal((await pool.resolutionProposal.findUniqueOrThrow({ where: { id: first.id } })).status, 'superseded');

  // reject leaves the market open; accept resolves it and pays the winners
  await rejectProposal(pool, { proposalId: second.id, moderatorId: moderator.id });
  assert.equal(await status(id), 'open');
  await assert.rejects(acceptProposal(pool, { proposalId: second.id, moderatorId: secondModerator }), { code: 'not_pending' });
  const again = await propose(pool, { marketId: id, outcomeId: yes, proposerId: moderator.id, evidence: 'Sunny at 2pm' });
  await acceptProposal(pool, { proposalId: again.id, moderatorId: secondModerator });
  assert.equal(await status(id), 'resolved');
  assert.equal((await pool.resolutionProposal.findUniqueOrThrow({ where: { id: again.id } })).status, 'accepted');
  await ledgerOk();

  const audit = await pool.auditEntry.findMany({ where: { marketId: id }, orderBy: { id: 'asc' }, select: { action: true } });
  assert.deepEqual(audit.map((a) => a.action), ['create_market', 'approve', 'buy', 'propose', 'propose', 'reject_proposal', 'propose', 'accept', 'resolve']);
});

test('rejecting a proposed market refunds nothing and opens nothing', async () => {
  const id = await createMarket(pool, { question: 'Bad idea?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 60, closeAt: tomorrow(), creatorId: users[0] });
  await rejectMarket(pool, { marketId: id, moderatorId: moderator.id, reason: 'off topic' });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id } })).status, 'rejected');
  assert.equal(await withTx(pool, async (db) => db.account.count({ where: { ownerType: 'market', ownerId: id } })), 0);
  await assert.rejects(approveMarket(pool, { marketId: id, moderatorId: moderator.id }), { code: 'not_pending' });
});

test('close job stops trading at close_at, finalises after the dispute window', async () => {
  const closeAt = new Date(Date.now() + 60_000);
  const { marketId, outcomeIds } = await open({ question: 'Closes soon?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt });
  const status = async () => (await pool.market.findUniqueOrThrow({ where: { id: marketId } })).status;

  await runMarketJobs(pool, new Date(Date.now() - 1000));
  assert.equal(await status(), 'open'); // not yet due
  await runMarketJobs(pool, new Date(closeAt.getTime() + 1000));
  assert.equal(await status(), 'closed');
  await assert.rejects(buy(pool, { userId: users[0], marketId, outcomeId: outcomeIds[0], spend: 5, minShares: 0, idempotencyKey: 'late-buy' }), { code: 'market_closed' });

  await resolve(pool, { marketId, outcomeId: outcomeIds[0], moderatorId: moderator.id });
  await runMarketJobs(pool, new Date());
  assert.equal(await status(), 'resolved'); // dispute window still open
  await runMarketJobs(pool, new Date(Date.now() + 25 * 3600_000));
  assert.equal(await status(), 'final');
  await ledgerOk();
});

test('roles: a moderator needs another moderator to confirm, an admin resolves alone, members cannot confirm', async () => {
  const admin = await pool.user.create({ data: { displayName: 'Boss', role: 'admin' } });
  const other = await pool.user.create({ data: { displayName: 'Mod Two', role: 'moderator' } });
  const [member] = users;

  const first = await open({ question: 'Mod proposal?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow() });
  const modProp = await propose(pool, { marketId: first.marketId, outcomeId: first.outcomeIds[0], proposerId: moderator.id, evidence: 'Results page' });
  assert.equal(modProp.status, 'pending');
  await assert.rejects(acceptProposal(pool, { proposalId: modProp.id, moderatorId: member }), { code: 'not_moderator' });
  await assert.rejects(acceptProposal(pool, { proposalId: modProp.id, moderatorId: moderator.id }), { code: 'second_moderator_needed' });
  await acceptProposal(pool, { proposalId: modProp.id, moderatorId: other.id });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: first.marketId } })).status, 'resolved');

  const second = await open({ question: 'Admin call?', criteria: 'x', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow() });
  const adminProp = await propose(pool, { marketId: second.marketId, outcomeId: second.outcomeIds[1], proposerId: admin.id, evidence: 'Official notice' });
  assert.equal(adminProp.status, 'accepted');
  const market = await pool.market.findUniqueOrThrow({ where: { id: second.marketId } });
  assert.equal(market.status, 'resolved');
  assert.equal(market.resolvedOutcomeId, second.outcomeIds[1]);
  await ledgerOk();
});
