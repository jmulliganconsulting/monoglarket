// Member reports go to the moderation queue (vault "Signup and profile": "This looks wrong"; "Moderation queue").
// Nothing changes automatically: a moderator or admin reads the report and decides.
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { notifyInvolved } from '../notifications/notify.ts';

export class ReportError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** 'market': something is wrong with the market. 'resolution': the result is wrong. 'profile': this member's own details. */
export async function fileReport(prisma: PrismaClient, r: { reporterId: number; kind: string; marketId?: number; body: string }) {
  const body = r.body.trim();
  if (body.length < 5 || body.length > 1000) throw new ReportError('body_length');
  if (r.kind === 'profile') {
    return withTx(prisma, async (db) => {
      const row = await db.report.create({ data: { reporterId: r.reporterId, kind: 'profile', subjectId: r.reporterId, body } });
      await audit(db, r.reporterId, 'report_filed', null, `profile report ${row.id}`);
      return row;
    });
  }
  if (r.kind !== 'market' && r.kind !== 'resolution') throw new ReportError('bad_kind');
  const market = r.marketId ? await prisma.market.findUnique({ where: { id: r.marketId }, select: { id: true, status: true, disputeUntil: true, question: true } }) : null;
  if (!market) throw new ReportError('market_not_found');
  // A result can be disputed only while the 24 h window is open (vault "Resolution and payouts").
  if (r.kind === 'resolution' && market.status !== 'resolved') throw new ReportError('not_decided');
  if (r.kind === 'resolution' && !market.disputeUntil) throw new ReportError('not_decided');
  if (r.kind === 'resolution' && market.disputeUntil! <= new Date()) throw new ReportError('dispute_closed');
  const report = await withTx(prisma, async (db) => {
    const row = await db.report.create({ data: { reporterId: r.reporterId, kind: r.kind, marketId: market.id, body } });
    await audit(db, r.reporterId, 'report_filed', market.id, `${r.kind} report ${row.id}`);
    return row;
  });
  // A dispute tells everyone holding the market (FR-20).
  if (r.kind === 'resolution') await notifyInvolved(prisma, market.id, 'disputed', `A result is being disputed: ${market.question}`);
  return report;
}

/** A moderator or admin closes an open report. 'upheld' means the complaint was right; the note says what was done. */
export async function handleReport(prisma: PrismaClient, r: { reportId: number; moderatorId: number; outcome: 'upheld' | 'dismissed'; note: string }) {
  return withTx(prisma, async (db) => {
    const report = await db.report.findUnique({ where: { id: r.reportId } });
    if (!report) throw new ReportError('not_found');
    const done = await db.report.updateMany({
      where: { id: r.reportId, status: 'open' },
      data: { status: r.outcome, note: r.note.trim().slice(0, 500), handledBy: r.moderatorId, handledAt: new Date() },
    });
    if (done.count !== 1) throw new ReportError('already_handled');
    await audit(db, r.moderatorId, `report_${r.outcome}`, report.marketId, `report ${report.id}`);
  });
}

const messages: Record<string, string> = {
  body_length: 'Say what is wrong, in 5 to 1000 characters.',
  bad_kind: 'Pick what the report is about.',
  market_not_found: 'That market no longer exists.',
  not_decided: 'You can dispute a result once the market has been decided.',
  dispute_closed: 'The dispute window for this result has closed.',
  already_handled: 'Someone has already dealt with this report.',
  not_found: 'That report no longer exists.',
};

export function reportMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  return code && code in messages ? messages[code] : 'Something went wrong. Try again.';
}
