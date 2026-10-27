// Editing a whole question: the words, criteria and close time reach every option, and a settled option blocks it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveQuestionGroup, createDateQuestion, editQuestion, grant, resolveDateQuestion } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, admin: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const later = () => new Date(Date.now() + 3 * 86_400_000);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'COIN', name: 'Coins', kind: 'internal' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  await grant(pool, admin, coin, 1000, `g:${admin}`);
});
after(() => drop());

const makeQuestion = () =>
  createDateQuestion(pool, {
    question: 'When will it happen?',
    criteria: 'Old criteria',
    currencyId: coin,
    days: [{ day: day('2030-01-01'), text: '1 Jan 2030' }, { day: day('2031-01-01'), text: '1 Jan 2031' }],
    subsidy: 70,
    closeAt: tomorrow(),
    creatorId: admin,
    spendCap: 100000,
  });

test('one save updates the question, criteria and close time of every option', async () => {
  const groupId = await makeQuestion();
  const closeAt = later();
  await editQuestion(pool, { groupId, adminId: admin, question: ' New question ', criteria: 'New criteria', closeAt , categoryId: null });
  const group = await pool.questionGroup.findUniqueOrThrow({ where: { id: groupId } });
  assert.equal(group.question, 'New question');
  assert.equal(group.resolutionCriteria, 'New criteria');
  assert.equal(group.closeAt?.getTime(), closeAt.getTime());
  const options = await pool.market.findMany({ where: { questionGroupId: groupId } });
  for (const o of options) {
    assert.equal(o.question, 'New question');
    assert.equal(o.resolutionCriteria, 'New criteria');
    assert.equal(o.closeAt?.getTime(), closeAt.getTime());
  }
});

test('the close time must be in the future, and the words cannot be blank', async () => {
  const groupId = await makeQuestion();
  await assert.rejects(editQuestion(pool, { groupId, adminId: admin, question: 'x', criteria: 'y', closeAt: new Date(Date.now() - 1000) , categoryId: null }), { code: 'bad_close' });
  await assert.rejects(editQuestion(pool, { groupId, adminId: admin, question: '  ', criteria: 'y', closeAt: later() , categoryId: null }), { code: 'missing_text' });
});

test('a question with a settled option cannot be edited', async () => {
  const groupId = await makeQuestion();
  await approveQuestionGroup(pool, { groupId, moderatorId: admin });
  await resolveDateQuestion(pool, { groupId, moderatorId: admin, at: day('2020-03-15') });
  await assert.rejects(editQuestion(pool, { groupId, adminId: admin, question: 'x', criteria: 'y', closeAt: later() , categoryId: null }), { code: 'not_editable' });
});
