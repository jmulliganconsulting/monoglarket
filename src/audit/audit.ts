// Audit trail for every action that changes state (NFR-07): member, moderator, admin, sign-in and scheduled job.
// actorId null = no signed-in person (a scheduled job, or a sign-in attempt we can't tie to a member).
// Pass the transaction client when the action is in one, so the audit row commits or rolls back with it.
import type { Db, PrismaClient } from '../db/db.ts';

export async function audit(db: Pick<Db, 'auditEntry'> | PrismaClient, actorId: number | null, action: string, marketId: number | null, detail: string) {
  await db.auditEntry.create({ data: { actorId, action, marketId, detail } });
}
