// Birthday for extra rewards (vault "Birthday"): set once, removable, never changed, never added back.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { isMonthDay, removeBirthday, setBirthday } from './birthday.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let ana: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
});
after(() => drop());

test('only real calendar days are accepted; Feb 29 is valid', () => {
  assert.equal(isMonthDay(2, 29), true);
  assert.equal(isMonthDay(2, 30), false);
  assert.equal(isMonthDay(13, 1), false);
});

test('a birthday is saved once and cannot be changed', async () => {
  await setBirthday(pool, ana, { month: 3, day: 14 });
  const u = await pool.user.findUniqueOrThrow({ where: { id: ana } });
  assert.deepEqual([u.birthMonth, u.birthDay], [3, 14]);
  await assert.rejects(setBirthday(pool, ana, { month: 5, day: 1 }), { code: 'birthday_locked' });
});

test('a removed birthday is gone and cannot be added back', async () => {
  await removeBirthday(pool, ana);
  const u = await pool.user.findUniqueOrThrow({ where: { id: ana } });
  assert.deepEqual([u.birthMonth, u.birthDay, u.birthdaySetAt], [null, null, null]);
  assert.ok(u.birthdayRemovedAt);
  await assert.rejects(setBirthday(pool, ana, { month: 3, day: 14 }), { code: 'birthday_removed' });
  await assert.rejects(removeBirthday(pool, ana), { code: 'no_birthday' });
});
