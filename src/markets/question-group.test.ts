// Several-winner questions (vault ADR-020): one yes/no market per option, approved together, each resolved on its own.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, checkLedger } from '../ledger/ledger.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, approveQuestionGroup, buy, createQuestionGroup, grant, resolve } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const wallet = (userId: number) => withTx(pool, async (db) => balance(db, await account(db, 'user', userId, coin)));
const house = () => withTx(pool, async (db) => balance(db, await account(db, 'house', 0, coin)));

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator' } })).id;
  for (const id of [mod, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

const group = (options: string[]) => ({
  question: 'Which teams make the playoffs?',
  criteria: 'Official standings on the closing date',
  currencyId: coin,
  options,
  subsidy: 70,
  closeAt: tomorrow(),
  creatorId: ana,
  spendCap: 100000,
});

test('each option becomes its own yes/no market with the full subsidy, sharing the question', async () => {
  const groupId = await createQuestionGroup(pool, group(['Team A', 'Team B', 'Team C']));
  const markets = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: { orderBy: { sort: 'asc' } } } });
  assert.deepEqual(markets.map((m) => m.optionLabel), ['Team A', 'Team B', 'Team C']);
  for (const m of markets) {
    assert.equal(m.status, 'pending_review');
    assert.equal(m.question, 'Which teams make the playoffs?');
    assert.deepEqual(m.outcomes.map((o) => o.label), ['Yes', 'No']);
    assert.ok(Math.abs(m.b - 70 / Math.log(2)) < 1e-9); // max loss per option is b · ln 2 = 70
  }
});

test('an option list with fewer than 2 or more than 10 options, or a repeat, is refused', async () => {
  await assert.rejects(createQuestionGroup(pool, group(['Only one'])), { code: 'bad_outcome_count' });
  await assert.rejects(createQuestionGroup(pool, group(['Team A', 'team a'])), { code: 'duplicate_option' });
});

test('approval funds every option at once, and each option pays out on its own result', async () => {
  const groupId = await createQuestionGroup(pool, group(['Ana side', 'Ben side']));
  const house0 = await house();
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  assert.equal((await house()) - house0, -140); // 70 per option

  const [a, b] = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: { orderBy: { sort: 'asc' } } } });
  assert.equal(a.status, 'open');
  assert.equal(b.status, 'open');
  const [aYes, bYes, bNo] = [a.outcomes[0].id, b.outcomes[0].id, b.outcomes[1].id];

  await buy(pool, { userId: ana, marketId: a.id, outcomeId: aYes, spend: 50, minShares: 0, idempotencyKey: 'ana-group-a' });
  await buy(pool, { userId: ben, marketId: b.id, outcomeId: bYes, spend: 50, minShares: 0, idempotencyKey: 'ben-group-b' });
  const anaShares = (await pool.position.findUniqueOrThrow({ where: { userId_outcomeId: { userId: ana, outcomeId: aYes } } })).shares.toNumber();
  const anaBefore = await wallet(ana);
  const benBefore = await wallet(ben);

  // Both options resolve, one Yes and one No. Ana's Yes on the first option pays; Ben's Yes on the second loses.
  await resolve(pool, { marketId: a.id, outcomeId: a.outcomes[0].id, moderatorId: mod });
  await resolve(pool, { marketId: b.id, outcomeId: bNo, moderatorId: mod });
  assert.equal(await wallet(ana), anaBefore + Math.floor(anaShares));
  assert.equal(await wallet(ben), benBefore);
  assert.deepEqual(await withTx(pool, (db) => checkLedger(db)), []);
});

test('an option approved on its own is left alone; the rest of the question is approved with the group', async () => {
  const groupId = await createQuestionGroup(pool, group(['Cy side', 'Dee side']));
  const [first, second] = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' } });
  await approveMarket(pool, { marketId: first.id, moderatorId: mod });
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: first.id } })).status, 'open');
  assert.equal((await pool.market.findUniqueOrThrow({ where: { id: second.id } })).status, 'open');
  // Nothing left to approve: a second group approval is refused, not repeated.
  await assert.rejects(approveQuestionGroup(pool, { groupId, moderatorId: mod }), { code: 'not_pending' });
});

test('approving an unknown question is refused', async () => {
  await assert.rejects(approveQuestionGroup(pool, { groupId: 999_999, moderatorId: mod }), { code: 'not_found' });
});
