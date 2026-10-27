// In-app notifications (FR-20, FR-24). Written inside the same transaction as the event where possible.
import type { Db, PrismaClient } from '../db/db.ts';

export type NoticeKind = 'resolved' | 'disputed' | 'closing' | 'overdue' | 'overdue_admin' | 'cancelled';

/** Everyone holding shares in the market right now. */
export async function holders(db: Db, marketId: number) {
  const rows = await db.position.findMany({ where: { marketId, shares: { gt: 0 } }, select: { userId: true }, distinct: ['userId'] });
  return rows.map((r) => r.userId);
}

/** Everyone who has ever traded in the market (a position row exists from the first buy), whether or not they still hold shares. */
export async function involved(db: Db, marketId: number) {
  const rows = await db.position.findMany({ where: { marketId }, select: { userId: true }, distinct: ['userId'] });
  return rows.map((r) => r.userId);
}

/** Tell everyone involved in the market: a result, a dispute, or a cancellation (FR-20). */
export async function notifyInvolved(db: Db, marketId: number, kind: NoticeKind, text: string) {
  const users = await involved(db, marketId);
  if (users.length) await db.notification.createMany({ data: users.map((userId) => ({ userId, kind, marketId, text })) });
}

/** Tell each holder. Repeat notices of one kind for one market (closing, overdue) are sent only once. */
export async function notifyHolders(db: Db, marketId: number, kind: NoticeKind, text: string) {
  const users = await holders(db, marketId);
  if (users.length) await db.notification.createMany({ data: users.map((userId) => ({ userId, kind, marketId, text })) });
}

/**
 * Scheduled (hourly from hooks): closing-soon notices to holders, overdue notices to moderators after 24 h and to admins after 7 days.
 * Each notice is written once per member and market.
 */
export async function runNotifications(prisma: PrismaClient, now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const closing = await prisma.market.findMany({ where: { status: 'open', closeAt: { gt: now, lte: soon } }, select: { id: true, question: true, closeAt: true } });
  let sent = 0;
  for (const m of closing) {
    const already = await prisma.notification.findFirst({ where: { marketId: m.id, kind: 'closing' }, select: { id: true } });
    if (already) continue;
    const users = await holders(prisma, m.id);
    await prisma.notification.createMany({ data: users.map((userId) => ({ userId, kind: 'closing', marketId: m.id, text: `Trading closes soon: ${m.question}` })) });
    sent += users.length;
  }

  // Overdue: a day after close, moderators hear; a week after close, admins too (FR-24).
  const overdue = await prisma.market.findMany({ where: { status: 'closed', closeAt: { lte: new Date(now.getTime() - 24 * 3600_000) } }, select: { id: true, question: true, closeAt: true } });
  for (const m of overdue) {
    if (!m.closeAt) continue;
    const late = now.getTime() - m.closeAt.getTime() >= 7 * 24 * 3600_000;
    const recipients = await prisma.user.findMany({ where: { role: { in: late ? ['admin'] : ['moderator', 'admin'] } }, select: { id: true } });
    const kind: NoticeKind = late ? 'overdue_admin' : 'overdue';
    for (const u of recipients) {
      const have = await prisma.notification.findFirst({ where: { userId: u.id, marketId: m.id, kind: { in: ['overdue', 'overdue_admin'] } }, select: { id: true } });
      if (have) continue;
      await prisma.notification.create({ data: { userId: u.id, kind, marketId: m.id, text: `Not resolved yet: ${m.question}` } });
      sent++;
    }
  }
  return { sent };
}
