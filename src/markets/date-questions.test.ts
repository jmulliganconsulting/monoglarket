// Date questions: each day is an "On or before this day" option, settled from the time the event happened.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveQuestionGroup, createDateQuestion, dateOptionWins, grant, resolveDateQuestion } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  for (const id of [mod, ana]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

const dateQuestion = (days: string[]) =>
  createDateQuestion(pool, {
    question: 'When will it happen?',
    criteria: 'The official announcement date',
    currencyId: coin,
    days: days.map((s) => ({ day: day(s), text: s })),
    subsidy: 70,
    closeAt: tomorrow(),
    creatorId: ana,
    spendCap: 100000,
  });

test('each day is one "on or before" option', async () => {
  const groupId = await dateQuestion(['2020-06-01']);
  const markets = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' } });
  assert.deepEqual(
    markets.map((m) => [m.optionLabel, m.dateMatch, m.optionDate?.toISOString()]),
    [['On or before 2020-06-01', 'by', '2020-06-01T00:00:00.000Z']],
  );
});

test('a day that is listed twice, or more than ten days, is refused', async () => {
  await assert.rejects(dateQuestion(['2020-06-01', '2020-06-01']), { code: 'duplicate_option' });
  const eleven = Array.from({ length: 11 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`);
  await assert.rejects(dateQuestion(eleven), { code: 'bad_outcome_count' });
});

test('the event settles every option from its time: the days it happened by win, earlier ones lose', async () => {
  const groupId = await dateQuestion(['2020-01-01', '2020-06-01']);
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  await resolveDateQuestion(pool, { groupId, moderatorId: mod, at: new Date('2020-03-15T14:30:00Z') });
  const markets = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: true } });
  const winners = markets.map((m) => [m.optionLabel, m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label]);
  assert.deepEqual(winners, [
    ['On or before 2020-01-01', 'No'],
    ['On or before 2020-06-01', 'Yes'],
  ]);
});

test('an admin can settle with a future time, for testing', async () => {
  const admin = await pool.user.create({ data: { displayName: 'Tester', role: 'admin' } });
  const groupId = await dateQuestion(['2020-06-01']);
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  await resolveDateQuestion(pool, { groupId, moderatorId: admin.id, at: tomorrow() });
  assert.equal(await pool.market.count({ where: { questionGroupId: groupId, status: 'resolved' } }), 1);
});

test('a second settle, or a settle with nothing open, is refused', async () => {
  const groupId = await dateQuestion(['2020-06-01']);
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  await resolveDateQuestion(pool, { groupId, moderatorId: mod, at: day('2020-03-15') });
  await assert.rejects(resolveDateQuestion(pool, { groupId, moderatorId: mod, at: day('2020-03-15') }), { code: 'not_resolvable' });
});

test('an event time in the future is refused, and nothing is settled while an option is waiting', async () => {
  const groupId = await dateQuestion(['2020-06-01']);
  await assert.rejects(resolveDateQuestion(pool, { groupId, moderatorId: mod, at: tomorrow() }), { code: 'bad_date' });
  await assert.rejects(resolveDateQuestion(pool, { groupId, moderatorId: mod, at: day('2020-03-15') }), { code: 'not_resolvable' });
  assert.equal(await pool.market.count({ where: { questionGroupId: groupId, status: 'resolved' } }), 0);
});

test('"on" wins only on its own day, "on or before" wins on that day and any later event', () => {
  const june = day('2020-06-01');
  assert.equal(dateOptionWins('on', june, new Date('2020-06-01T23:59:00Z')), true);
  assert.equal(dateOptionWins('on', june, new Date('2020-05-31T23:59:00Z')), false);
  assert.equal(dateOptionWins('on', june, day('2020-06-02')), false);
  assert.equal(dateOptionWins('by', june, new Date('2020-05-31T23:59:00Z')), true);
  assert.equal(dateOptionWins('by', june, new Date('2020-06-01T23:59:00Z')), true);
  assert.equal(dateOptionWins('by', june, day('2020-06-02')), false);
});
