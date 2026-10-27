// Who can see which markets (vault "Market visibility"). One rule, used by every listing and by the market page.
import type { PrismaClient } from '../db/db.ts';
import { isModerator } from '../auth/roles.ts';

export type Viewer = { id: number; role: string; groupIds: number[] };

export async function viewerOf(prisma: PrismaClient, user: { id: number; role: string }): Promise<Viewer> {
  const groups = await prisma.groupMember.findMany({ where: { userId: user.id }, select: { groupId: true } });
  return { id: user.id, role: user.role, groupIds: groups.map((g) => g.groupId) };
}

export function canSee(m: { visibility: string; groupId: number | null; deletedAt: Date | null }, v: Viewer): boolean {
  if (m.deletedAt) return v.role === 'admin';
  if (isModerator(v.role)) return true;
  if (m.visibility === 'hidden') return false;
  if (m.visibility === 'group') return m.groupId !== null && v.groupIds.includes(m.groupId);
  return true;
}

/** Prisma filter for listings: not deleted, and visible to this viewer. */
export function listable(v: Viewer) {
  if (isModerator(v.role)) return { deletedAt: null };
  return { deletedAt: null, OR: [{ visibility: 'public' }, { visibility: 'group', groupId: { in: v.groupIds } }] };
}
