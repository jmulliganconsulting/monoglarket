// Birthday for extra rewards (vault "Birthday"). Saved only when the member ticks the rewards box. Set once, removable,
// never changed, and never added back after removal, so a birthday can't be moved to pay a reward twice.
import type { PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { UserError } from './users.ts';

/** Real calendar day; 2000 is a leap year, so Feb 29 is valid. */
export function isMonthDay(month: number, day: number) {
  const d = new Date(Date.UTC(2000, month - 1, day));
  return month >= 1 && month <= 12 && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export async function setBirthday(prisma: PrismaClient, userId: number, md: { month: number; day: number }, now = new Date()) {
  if (!isMonthDay(md.month, md.day)) throw new UserError('birthday_invalid');
  const r = await prisma.user.updateMany({
    where: { id: userId, birthdaySetAt: null, birthdayRemovedAt: null },
    data: { birthMonth: md.month, birthDay: md.day, birthdaySetAt: now },
  });
  if (r.count === 1) {
    await audit(prisma, userId, 'set_birthday', null, 'month and day saved');
    return;
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { birthdaySetAt: true, birthdayRemovedAt: true } });
  throw new UserError(u.birthdayRemovedAt ? 'birthday_removed' : 'birthday_locked');
}

/** Removing clears the birthday and its rewards. It can't be added back afterwards. */
export async function removeBirthday(prisma: PrismaClient, userId: number, now = new Date()) {
  const r = await prisma.user.updateMany({
    where: { id: userId, birthdaySetAt: { not: null }, birthdayRemovedAt: null },
    data: { birthMonth: null, birthDay: null, birthdaySetAt: null, birthdayRemovedAt: now },
  });
  if (r.count !== 1) throw new UserError('no_birthday');
  await audit(prisma, userId, 'remove_birthday', null, 'birthday removed');
}
