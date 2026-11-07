// Date questions: each option is a span of days or times ("Before 11/15", "Sunday at 3pm") in the creator's zone, settled from when it happened.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveQuestionGroup, createDateQuestion, dateOptionWins, grant, resolveDateQuestion } from './markets.ts';
import { describeWhen, optionLabelIn, parseWhen, readWhen, whenHolds } from './when.ts';

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

const dateQuestion = (days: string[], tz = 'UTC') =>
  createDateQuestion(pool, {
    question: 'When will it happen?',
    criteria: 'The official announcement date',
    currencyId: coin,
    days,
    tz,
    subsidy: 70,
    closeAt: tomorrow(),
    creatorId: ana,
    spendCap: 100000,
  });

const NY = 'America/New_York';
const at = (s: string) => new Date(s);

test('each line is an option: a label spelling out what was understood, its span, and its end for ordering', async () => {
  const groupId = await dateQuestion(['Before 2020-06-01', '2020-06-03', 'After 2020-06-03'], NY);
  const markets = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' } });
  assert.deepEqual(
    markets.map((m) => [m.optionLabel, m.dateMatch, m.optionDate?.toISOString()]),
    [
      // Days run midnight to midnight in the creator's zone: "Before 6/1" ends at 11:59 pm on 5/31, New York time.
      ['By Sun, May 31, 2020', 'range', '2020-06-01T04:00:00.000Z'],
      ['On Wed, Jun 3, 2020', 'range', '2020-06-04T04:00:00.000Z'],
      ['From Thu, Jun 4, 2020', 'range', '2020-06-04T04:00:00.000Z'],
    ],
  );
  assert.deepEqual(readWhen(markets[2].optionRange), { lo: Date.parse('2020-06-04T04:00:00Z'), hi: null, tz: NY, time: false, date: true });
});

test("options parse the way people write them, in the creator's zone", () => {
  const now = Date.parse('2026-11-06T17:00:00Z'); // Fri 6 Nov, noon in New York
  const holds = (option: string, when: string) => whenHolds(parseWhen(option, NY, now)!, at(when));
  // Days
  assert.ok(holds('Before 11/15', '2026-11-15T04:59:00Z') && !holds('Before 11/15', '2026-11-15T05:00:00Z'));
  assert.ok(holds('By 11/15', '2026-11-16T04:59:00Z') && !holds('By 11/15', '2026-11-16T05:00:00Z'));
  assert.ok(holds('11/21', '2026-11-21T05:00:00Z') && !holds('11/21', '2026-11-21T04:59:00Z'));
  assert.ok(holds('11/15-11/20', '2026-11-20T12:00:00Z') && !holds('11/15 - 11/20', '2026-11-21T12:00:00Z'));
  assert.ok(holds('After 12/1', '2026-12-02T12:00:00Z') && !holds('After 12/1', '2026-12-01T12:00:00Z') && holds('After 12/1', '2030-01-01T00:00:00Z'));
  assert.ok(holds('1/5', '2027-01-05T12:00:00Z'), 'a past month/day rolls to next year');
  assert.ok(holds('today', '2026-11-06T23:00:00Z') && holds('11/6', '2026-11-06T23:00:00Z'));
  // Times: on their own a deadline, today unless a day is named; a weekday is the next one
  assert.ok(holds('Before 3:00pm', '2026-11-06T19:59:00Z') && !holds('before 3:00 PM', '2026-11-06T20:00:00Z'));
  assert.ok(holds('3pm', '2026-11-06T19:00:00Z') && !holds('3pm', '2026-11-06T20:00:00Z'));
  assert.ok(holds('Sunday at 3:00pm', '2026-11-08T19:59:00Z') && !holds('Sunday at 3:00pm', '2026-11-08T20:00:00Z'));
  assert.ok(holds('Sat 9am-5pm', '2026-11-07T14:00:00Z') && !holds('Sat 9am-5pm', '2026-11-07T22:00:00Z'));
  assert.ok(holds('After Saturday 17:00', '2026-11-07T22:01:00Z') && holds('11/7 at noon+', '2026-11-07T17:00:00Z'));
  for (const bad of ['soon', '2/30', '11/20-11/15', '11/15 11/16', 'Before', '13pm', '10pm-2am', 'between 11/15']) assert.equal(parseWhen(bad, NY, now), null, bad);
  assert.equal(parseWhen('11/15', 'Not/AZone', now), null);
});

test("a time reads in the viewer's zone with the zone named; whole days read as the creator's days", () => {
  const now = Date.parse('2026-11-06T17:00:00Z');
  const three = parseWhen('Before 3pm', NY, now)!;
  assert.equal(describeWhen(three, NY), 'Before 3:00 PM EST');
  assert.equal(describeWhen(three, 'America/Los_Angeles'), 'Before 12:00 PM PST');
  assert.equal(describeWhen(three, 'UTC'), 'Before 8:00 PM UTC');
  assert.equal(describeWhen(parseWhen('Sat 9am-5pm', NY, now)!, NY), 'Sat, Nov 7, 9:00 AM EST – 5:00 PM EST');
  assert.equal(describeWhen(parseWhen('Before 11/15', NY, now)!, 'Asia/Tokyo'), 'By Sat, Nov 14');
  assert.equal(optionLabelIn('Before 3:00 PM EST', JSON.stringify(three), 'America/Chicago'), 'Before 2:00 PM CST');
  assert.equal(optionLabelIn('20-21', '20-21', 'America/Chicago'), '20-21', 'a numeric option is left alone');
});

test('a day listed twice, more than twenty, a line that is not a day, or an unknown zone, is refused', async () => {
  await assert.rejects(dateQuestion(['2020-06-01', '2020-06-01']), { code: 'duplicate_option' });
  const many = Array.from({ length: 21 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`);
  await assert.rejects(dateQuestion(many), { code: 'bad_date_count' });
  await assert.rejects(dateQuestion(['soon']), { code: 'bad_date' });
  await assert.rejects(dateQuestion(['2020-06-01'], 'Mars/Base'), { code: 'bad_zone' });
});

test('when it happened settles every option: each one whose span holds that moment wins', async () => {
  const groupId = await dateQuestion(['Before 2020-03-15', 'By 2020-03-15', '2020-03-15', '2020-03-16', '2020-03-10 to 2020-03-20', 'After 2020-03-20', '2020-03-15 9am-2pm'], NY);
  await approveQuestionGroup(pool, { groupId, moderatorId: mod });
  // 2:30 pm UTC is 10:30 am in New York, on the 15th.
  await resolveDateQuestion(pool, { groupId, moderatorId: mod, at: at('2020-03-15T14:30:00Z') });
  const markets = await pool.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: true } });
  assert.deepEqual(markets.map((m) => m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label), ['No', 'Yes', 'Yes', 'No', 'Yes', 'No', 'Yes']);
  assert.equal((await pool.questionGroup.findUniqueOrThrow({ where: { id: groupId } })).answer, '2020-03-15T14:30:00.000Z');
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
