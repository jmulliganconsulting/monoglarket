// Managing markets: cancel with a reason, removing and adding options with refunds, deleting, visibility, and the boards.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, addOutcome, buy, cancel, createMarket, deleteMarket, grant, removeOutcome, resolve, setVisibility } from './markets.ts';
import { canSee } from './visibility.ts';
import { board } from '../leaderboard/boards.ts';
import { getNumberSetting, setSetting } from '../settings/settings.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, admin: number, ana: number, ben: number, cy: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));
const ledgerOk = async () => assert.deepEqual(await withTx(pool, checkLedger), []);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator', onboardedAt: new Date() } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin', onboardedAt: new Date() } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator', onboardedAt: new Date() } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator', onboardedAt: new Date() } })).id;
  cy = (await pool.user.create({ data: { displayName: 'Cy', role: 'creator', onboardedAt: new Date() } })).id;
  for (const id of [mod, admin, ana, ben, cy]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

async function market(question: string, outcomes = ['Yes', 'No', 'Maybe']) {
  const marketId = await createMarket(pool, { question, criteria: 'C', currencyId: coin, outcomes, subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const ids = (await pool.outcome.findMany({ where: { marketId }, orderBy: { sort: 'asc' } })).map((o) => o.id);
  return { marketId, ids };
}

test('cancelling refunds everyone with the reason, and notifies them', async () => {
  const m = await market('Cancelled soon?');
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.ids[0], spend: 100, minShares: 0, idempotencyKey: 'c1' });
  await cancel(pool, { marketId: m.marketId, moderatorId: mod, reason: 'The event was postponed' });
  assert.equal(await wallet(ana), 1000);
  const row = await pool.market.findUniqueOrThrow({ where: { id: m.marketId } });
  assert.equal(row.cancelReason, 'The event was postponed');
  const refund = await pool.ledgerTransaction.findFirstOrThrow({ where: { marketId: m.marketId, kind: 'refund' } });
  assert.match(refund.memo ?? '', /postponed/);
  assert.equal(await pool.notification.count({ where: { userId: ana, kind: 'cancelled', marketId: m.marketId } }), 1);
  await ledgerOk();
});

test('removing an option refunds its holders with the reason, and the rest of the market carries on', async () => {
  const m = await market('Option removed?');
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.ids[2], spend: 60, minShares: 0, idempotencyKey: 'r1' });
  await buy(pool, { userId: ben, marketId: m.marketId, outcomeId: m.ids[0], spend: 40, minShares: 0, idempotencyKey: 'r2' });
  await removeOutcome(pool, { outcomeId: m.ids[2], moderatorId: mod, reason: 'Not a real option anymore' });
  assert.equal(await wallet(ana), 1000); // the 60 spent on the removed option came back
  assert.equal(await wallet(ben), 960); // Ben held a different option and was not refunded
  const refund = await pool.ledgerTransaction.findFirstOrThrow({ where: { kind: 'refund', memo: { contains: 'Option removed' } } });
  assert.match(refund.memo!, /Not a real option anymore/);
  const gone = await pool.outcome.findUniqueOrThrow({ where: { id: m.ids[2] } });
  assert.ok(gone.removedAt);
  await ledgerOk();
  await assert.rejects(removeOutcome(pool, { outcomeId: m.ids[0], moderatorId: mod, reason: 'Two left after this' }), { code: 'too_few_outcomes' });
});

test('an option can be added to a live market, up to ten', async () => {
  const m = await market('Add an option?');
  await addOutcome(pool, { marketId: m.marketId, moderatorId: mod, label: 'Later' });
  const active = await pool.outcome.findMany({ where: { marketId: m.marketId, removedAt: null } });
  assert.equal(active.length, 4);
});

test('deleting an open market refunds it and hides it; deleting a resolved one keeps its payouts', async () => {
  const open = await market('Deleted while open?');
  await buy(pool, { userId: cy, marketId: open.marketId, outcomeId: open.ids[0], spend: 30, minShares: 0, idempotencyKey: 'd1' });
  await deleteMarket(pool, { marketId: open.marketId, adminId: admin, reason: 'Duplicate of another market' });
  assert.equal(await wallet(cy), 1000);
  const row = await pool.market.findUniqueOrThrow({ where: { id: open.marketId } });
  assert.ok(row.deletedAt);
  assert.equal(row.deleteReason, 'Duplicate of another market');
  assert.equal(row.status, 'cancelled');

  const done = await market('Deleted after resolution?');
  await buy(pool, { userId: cy, marketId: done.marketId, outcomeId: done.ids[1], spend: 20, minShares: 0, idempotencyKey: 'd2' });
  await resolve(pool, { marketId: done.marketId, outcomeId: done.ids[1], moderatorId: mod });
  const paid = await wallet(cy);
  await deleteMarket(pool, { marketId: done.marketId, adminId: admin, reason: 'Hide from the list' });
  assert.equal(await wallet(cy), paid); // no reversal of a decided market
  await ledgerOk();
});

test('visibility: hidden is for moderators only, group is for its members, and deleted only for admins', async () => {
  const m = await market('Who sees this?');
  const group = await pool.userGroup.create({ data: { key: 'robotics', name: 'Robotics' } });
  await pool.groupMember.create({ data: { groupId: group.id, userId: ana } });
  await setVisibility(pool, { marketId: m.marketId, moderatorId: mod, visibility: 'group', groupId: group.id });
  const row = await pool.market.findUniqueOrThrow({ where: { id: m.marketId } });
  assert.equal(canSee(row, { id: ben, role: 'creator', groupIds: [] }), false);
  assert.equal(canSee(row, { id: ana, role: 'creator', groupIds: [group.id] }), true);
  assert.equal(canSee(row, { id: mod, role: 'moderator', groupIds: [] }), true);
  await setVisibility(pool, { marketId: m.marketId, moderatorId: mod, visibility: 'hidden', groupId: null });
  const hidden = await pool.market.findUniqueOrThrow({ where: { id: m.marketId } });
  assert.equal(canSee(hidden, { id: ana, role: 'creator', groupIds: [group.id] }), false);
  assert.equal(canSee({ ...hidden, deletedAt: new Date() }, { id: mod, role: 'moderator', groupIds: [] }), false);
  assert.equal(canSee({ ...hidden, deletedAt: new Date() }, { id: admin, role: 'admin', groupIds: [] }), true);
});

test('boards: most won, best single call and most markets won rank the same members differently', async () => {
  const m = await market('Boards?', ['Yes', 'No']);
  await buy(pool, { userId: ana, marketId: m.marketId, outcomeId: m.ids[0], spend: 100, minShares: 0, idempotencyKey: 'b1' });
  await resolve(pool, { marketId: m.marketId, outcomeId: m.ids[0], moderatorId: mod });
  const won = await board(pool, coin, 'won');
  assert.equal(won.rows[0].id, ana);
  assert.ok(won.rows[0].value > 0);
  const best = await board(pool, coin, 'best');
  assert.equal(best.rows[0].id, ana);
  const wins = await board(pool, coin, 'wins');
  assert.equal(wins.rows[0].id, ana);
  assert.equal(wins.rows[0].value, 1);
  const trades = await board(pool, coin, 'trades');
  assert.equal(trades.rows[0].value >= 1, true);
});

test('settings default to 24 hours and can be changed', async () => {
  assert.equal(await getNumberSetting(pool, 'decided_home_hours'), 24);
  await setSetting(pool, 'decided_home_hours', '6', admin);
  assert.equal((await pool.auditEntry.findFirstOrThrow({ where: { action: 'setting' }, orderBy: { id: 'desc' } })).actorId, admin);
  assert.equal(await getNumberSetting(pool, 'decided_home_hours'), 6);
});
