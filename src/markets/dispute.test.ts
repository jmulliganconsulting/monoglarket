// Dispute window and re-resolution (vault "Resolution and payouts"). Every change is a ledger entry, so the books still balance.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { fileReport } from '../reports/reports.ts';
import { approveMarket, buy, createMarket, grant, reResolve, resolve } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod1: number, mod2: number, ana: number, ben: number, cy: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));
const ledgerOk = async () => assert.deepEqual(await withTx(pool, checkLedger), []);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  const mk = async (name: string, role: string) => (await pool.user.create({ data: { displayName: name, role } })).id;
  mod1 = await mk('Mod1', 'moderator');
  mod2 = await mk('Mod2', 'moderator');
  ana = await mk('Ana', 'creator');
  ben = await mk('Ben', 'creator');
  cy = await mk('Cy', 'creator');
  for (const id of [mod1, mod2, ana, ben, cy]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

async function market(question: string) {
  const marketId = await createMarket(pool, { question, criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod1 });
  const [yes, no] = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  return { marketId, yes, no };
}

test('a different moderator changes the result inside the window: payouts are reversed and paid to the new winners', async () => {
  const m = await market('Changed later?');
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 100, minShares: 0, idempotencyKey: 'd1' });
  await buy(pool, { userId: ben, marketId: m.marketId, outcomeId: m.no, spend: 100, minShares: 0, idempotencyKey: 'd2' });
  await resolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod1 });
  const anaPaid = await wallet(ana);
  const benBefore = await wallet(ben);
  assert.ok(anaPaid > 900);

  await reResolve(pool, { marketId: m.marketId, outcomeId: m.no, moderatorId: mod2, evidence: 'Official page says No' });
  assert.equal(await wallet(ana), 900); // exactly what she had before the payout
  assert.ok((await wallet(ben)) > benBefore); // now the holder of No is paid
  await ledgerOk();

  const row = await pool.market.findUniqueOrThrow({ where: { id: m.marketId } });
  assert.equal(row.resolvedOutcomeId, m.no);
  assert.equal(row.resolvedBy, mod2);
  assert.ok(row.disputeUntil! > new Date(Date.now() + 23 * 3600_000)); // the window starts again
});

test('the person who set the result cannot change it; a changed result to the same outcome is refused', async () => {
  const m = await market('Same person?');
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.yes, spend: 50, minShares: 0, idempotencyKey: 'd3' });
  await resolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod1 });
  await assert.rejects(reResolve(pool, { marketId: m.marketId, outcomeId: m.no, moderatorId: mod1, evidence: 'x' }), { code: 'second_moderator_needed' });
  await assert.rejects(reResolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod2, evidence: 'x' }), { code: 'same_outcome' });
  await ledgerOk();
});

test('after the window closes the result is fixed', async () => {
  const m = await market('Too late?');
  await resolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod1 });
  await pool.market.update({ where: { id: m.marketId }, data: { disputeUntil: new Date(Date.now() - 1000) } });
  await assert.rejects(reResolve(pool, { marketId: m.marketId, outcomeId: m.no, moderatorId: mod2, evidence: 'x' }), { code: 'dispute_closed' });
});

test('a winner who already spent the winnings goes below zero on a change, and the ledger still balances', async () => {
  const first = await market('Spent already?');
  await buy(pool, { userId: cy, marketId: first.marketId, outcomeId: first.yes, spend: 100, minShares: 0, idempotencyKey: 'd4' });
  await resolve(pool, { marketId: first.marketId, outcomeId: first.yes, moderatorId: mod1 });
  const spendAll = await wallet(cy);
  const second = await market('Where the winnings went');
  await buy(pool, { userId: cy, marketId: second.marketId, outcomeId: second.yes, spend: spendAll, minShares: 0, idempotencyKey: 'd5' });
  assert.equal(await wallet(cy), 0);
  await reResolve(pool, { marketId: first.marketId, outcomeId: first.no, moderatorId: mod2, evidence: 'Official page says No' });
  assert.ok((await wallet(cy)) < 0);
  await ledgerOk();
});

test('a result can be disputed only while the window is open', async () => {
  const m = await market('Disputed?');
  await resolve(pool, { marketId: m.marketId, outcomeId: m.yes, moderatorId: mod1 });
  const r = await fileReport(pool, { reporterId: ben, kind: 'resolution', marketId: m.marketId, body: 'That result is wrong' });
  assert.equal(r.kind, 'resolution');
  await pool.market.update({ where: { id: m.marketId }, data: { disputeUntil: new Date(Date.now() - 1000) } });
  await assert.rejects(fileReport(pool, { reporterId: ben, kind: 'resolution', marketId: m.marketId, body: 'Still wrong' }), { code: 'dispute_closed' });
});
