import type { PrismaClient } from '../db/db.ts';
import { snapshot, type Snapshot } from './hub.ts';

/** Current prices of every open or closed market, for the list's first event. */
export async function listSnapshot(prisma: PrismaClient): Promise<Snapshot[]> {
  const ids = await prisma.market.findMany({ where: { status: { in: ['open', 'closed'] }, visibility: 'public', deletedAt: null }, select: { id: true } });
  return (await Promise.all(ids.map((m) => snapshot(prisma, m.id)))).filter((s): s is Snapshot => s !== null);
}
