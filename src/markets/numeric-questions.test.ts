// Numeric questions (each option a range, settled from one number) and settling a several-winner question in one go.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveQuestionGroup, createNumericQuestion, createQuestionGroup, grant, resolveNumericQuestion, resolveQuestionOptions } from './markets.ts';
import { parseRange, rangeHolds } from './ranges.ts';

test('ranges parse the way people write them', () => {
  const holds = (option: string, answer: string) => rangeHolds(parseRange(option)!, parseRange(answer)!);
  assert.equal(parseRange('5-3'), null);
  assert.equal(parseRange('lots'), null);
  assert.ok(holds('20-21', '20') && holds('20-21', '21') && !holds('20-21', '22'));
  assert.ok(holds('≤19', '19') && holds('<=19', '0') && !holds('≤19', '20'));
  assert.ok(holds('32+', '32') && !holds('32+', '31.9'));
  assert.ok(holds('Above $4.60', '4.61') && !holds('Above $4.60', '4.60'));
  assert.ok(holds('under 10', '9') && !holds('under 10', '10'));
  assert.ok(holds('1,000-2,000', '1500'));
  // A range answer wins only the options that hold all of it.
  assert.ok(holds('20-25', '20-21') && !holds('20-21', '21-22'));
});

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  for (const id of [mod, ana]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

const shared = () => ({ question: 'How many check in?', criteria: 'The door count', currencyId: coin, subsidy: 50, closeAt: new Date(Date.now() + 86_400_000), creatorId: ana });
const results = async (groupId: number) =>
  (await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: true } })).map(
    (m) => `${m.optionLabel}:${m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label}`,
  );

test('a numeric question settles every option from one number', async () => {
  const groupId = await createNumericQuestion(pool, { ...shared(), ranges: ['≤19', '20-29', '30+', 'Above 25'] });
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  await resolveNumericQuestion(pool, { groupId, moderatorId: mod, answer: '27' });
  assert.deepEqual(await results(groupId), ['≤19:No', '20-29:Yes', '30+:No', 'Above 25:Yes']);
  assert.equal((await pool.questionGroup.findUniqueOrThrow({ where: { id: groupId } })).answer, '27');
});

test('a numeric question refuses ranges it cannot read, and open-ended answers', async () => {
  await assert.rejects(createNumericQuestion(pool, { ...shared(), ranges: ['1-5', 'some'] }), { code: 'bad_range' });
  const groupId = await createNumericQuestion(pool, { ...shared(), ranges: ['1-5', '6+'] });
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  await assert.rejects(resolveNumericQuestion(pool, { groupId, moderatorId: mod, answer: '6+' }), { code: 'bad_answer' });
});

test('a several-winner question settles the ticked options Yes and the rest No, together', async () => {
  const groupId = await createQuestionGroup(pool, { ...shared(), options: ['Pizza', 'Tacos', 'Sushi'] });
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  const ids = (await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' } })).map((m) => m.id);
  await assert.rejects(resolveQuestionOptions(pool, { groupId, moderatorId: mod, winners: [ids[0], 99999] }), { code: 'bad_outcome' });
  await resolveQuestionOptions(pool, { groupId, moderatorId: mod, winners: [ids[0], ids[2]] });
  assert.deepEqual(await results(groupId), ['Pizza:Yes', 'Tacos:No', 'Sushi:Yes']);
});
