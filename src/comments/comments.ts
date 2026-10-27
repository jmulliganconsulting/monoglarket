// Comments on markets (FR-13, vault "Auth and roles": moderators may hide comments). Every hide is audited.
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { UserError } from '../users/users.ts';

export const COMMENT_MAX = 500;
/** Anti-spam: at most this many comments a member can post in a minute. */
export const COMMENTS_PER_MINUTE = 5;

const VISIBLE_STATUSES = ['open', 'closed', 'resolved', 'final', 'cancelled'];

export async function postComment(prisma: PrismaClient, c: { marketId: number; userId: number; body: string }, now = new Date()) {
  const body = c.body.trim();
  if (body.length < 1 || body.length > COMMENT_MAX) throw new UserError('comment_length');
  const market = await prisma.market.findUnique({ where: { id: c.marketId }, select: { status: true } });
  if (!market || !VISIBLE_STATUSES.includes(market.status)) throw new UserError('comment_closed');
  const recent = await prisma.marketComment.count({ where: { userId: c.userId, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
  if (recent >= COMMENTS_PER_MINUTE) throw new UserError('comment_rate');
  return withTx(prisma, async (db) => {
    const row = await db.marketComment.create({ data: { marketId: c.marketId, userId: c.userId, body } });
    await audit(db, c.userId, 'comment', c.marketId, `comment ${row.id}`);
    return row;
  });
}

export async function hideComment(prisma: PrismaClient, r: { commentId: number; moderatorId: number }) {
  return withTx(prisma, async (db) => {
    const c = await db.marketComment.findUnique({ where: { id: r.commentId }, select: { id: true, marketId: true, hiddenAt: true } });
    if (!c) throw new UserError('not_found');
    if (c.hiddenAt) throw new UserError('already_hidden');
    await db.marketComment.update({ where: { id: c.id }, data: { hiddenAt: new Date(), hiddenBy: r.moderatorId } });
    await audit(db, r.moderatorId, 'hide_comment', c.marketId, `comment ${c.id}`);
  });
}
