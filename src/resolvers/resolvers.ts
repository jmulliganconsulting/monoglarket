// Scheduled job (hooks.server.ts, every 5 min): asks each closed market's source for an answer. The answer waits for a moderator.
import type { PrismaClient } from '../db/db.ts';
import { proposeFromResolver } from '../markets/markets.ts';
import { SOURCES, type ResolverSource } from './sources.ts';

export async function runResolvers(prisma: PrismaClient, sources: Record<string, ResolverSource> = SOURCES) {
  const due = await prisma.market.findMany({
    where: { status: 'closed', resolverSource: { not: null } },
    include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true } } },
  });
  let proposed = 0;
  for (const m of due) {
    const source = sources[m.resolverSource!];
    if (!source) continue; // source removed from the code: the market waits for a moderator
    try {
      const r = await source.check({ id: m.id, question: m.question, closeAt: m.closeAt, outcomes: m.outcomes.map((o) => o.label) });
      if (r.status !== 'proposal') continue;
      const outcome = m.outcomes.find((o) => o.label === r.outcome);
      if (!outcome) throw new Error(`no outcome called "${r.outcome}"`);
      if (await proposeFromResolver(prisma, { marketId: m.id, outcomeId: outcome.id, evidence: r.evidence })) proposed++;
    } catch (e) {
      console.error(`Resolver ${m.resolverSource} failed for market ${m.id}: ${(e as Error).message}`);
    }
  }
  return { checked: due.length, proposed };
}

/**
 * "Test now" (FR-26): asks the market's source what it would say, without proposing anything. For moderators checking a source.
 */
export async function testSource(prisma: PrismaClient, marketId: number, sources: Record<string, ResolverSource> = SOURCES) {
  const m = await prisma.market.findUnique({ where: { id: marketId }, include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { label: true } } } });
  if (!m?.resolverSource) return { ok: false, message: 'This market has no automatic source.' };
  const source = sources[m.resolverSource];
  if (!source) return { ok: false, message: 'That source is not set up in the code any more.' };
  try {
    const r = await source.check({ id: m.id, question: m.question, closeAt: m.closeAt, outcomes: m.outcomes.map((o) => o.label) });
    return r.status === 'proposal' ? { ok: true, message: `Today it would say “${r.outcome}”. Evidence: ${r.evidence}` } : { ok: true, message: 'Today it would say nothing yet.' };
  } catch (e) {
    return { ok: false, message: `The source failed: ${(e as Error).message}` };
  }
}
