// Member breaks and admin actions on signup blocks (vault "Signup and profile", "Take a break"; "Auth and roles").
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';

export class UserError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const DAY_MS = 24 * 3600_000;

/** Break lengths members can pick (vault: 1 day, 1 week, 1 month). */
export const BREAK_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

export const onBreak = (user: { breakUntil: Date | null }, now = new Date()) => !!user.breakUntil && user.breakUntil > now;

/** A break only ever extends: a member on a month-long break can't reset it to a day. Members can't end one early. */
export async function startBreak(prisma: PrismaClient, userId: number, length: string, now = new Date()) {
  const days = BREAK_DAYS[length];
  if (!days) throw new UserError('bad_break');
  const until = new Date(now.getTime() + days * DAY_MS);
  await prisma.user.updateMany({ where: { id: userId, OR: [{ breakUntil: null }, { breakUntil: { lt: until } }] }, data: { breakUntil: until } });
}

/** Admin only: end a member's break early. */
export async function endBreak(prisma: PrismaClient, adminId: number, userId: number) {
  return withTx(prisma, async (db) => {
    await db.user.update({ where: { id: userId }, data: { breakUntil: null } });
    await audit(db, adminId, 'end_break', null, `user ${userId}`);
  });
}

/** Admin only: lift a signup block so the email can sign in and onboard again. */
export async function liftBlock(prisma: PrismaClient, adminId: number, blockId: number) {
  return withTx(prisma, async (db) => {
    const r = await db.signupBlock.updateMany({ where: { id: blockId, unblockedAt: null }, data: { unblockedAt: new Date(), unblockedBy: adminId } });
    if (r.count !== 1) throw new UserError('not_blocked');
    await audit(db, adminId, 'lift_block', null, `block ${blockId}`);
  });
}

const messages: Record<string, string> = {
  bad_break: 'Pick a break length from the list.',
  birthday_invalid: 'That date doesn’t exist.',
  birthday_locked: 'Your birthday can’t be changed once it is saved. You can remove it, but not change it.',
  birthday_removed: 'A removed birthday can’t be added back.',
  no_birthday: 'There is no birthday saved to remove.',
  bad_adjust_amount: 'Enter a whole number, not zero, and no more than 1,000,000.',
  reason_required: 'Give an admin reason of at least 5 characters. Only admins can read it.',
  public_reason_long: 'The public reason is 280 characters at most.',
  bad_currency: 'Pick an internal currency.',
  no_member: 'No member has that username or email.',
  insufficient_balance: 'That would take their balance below zero.',
  comment_length: 'Write 1 to 500 characters.',
  comment_closed: 'Comments open once the market is approved.',
  comment_rate: 'You are commenting quickly. Wait a minute and try again.',
  group_name: 'Name the group.',
  group_taken: 'A group with that name already exists.',
  already_hidden: 'That comment is already hidden.',
  not_blocked: 'That block has already been lifted.',
};

export function userMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  return code && code in messages ? messages[code] : 'Something went wrong. Try again.';
}
