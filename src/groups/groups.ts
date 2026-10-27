// User groups (for markets limited to a group) and their members. Admins only (vault "Market visibility").
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { UserError } from '../users/users.ts';

export async function createGroup(prisma: PrismaClient, r: { adminId: number; name: string }) {
  const name = r.name.trim().slice(0, 60);
  if (!name) throw new UserError('group_name');
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key) throw new UserError('group_name');
  return withTx(prisma, async (db) => {
    if (await db.userGroup.findUnique({ where: { key }, select: { id: true } })) throw new UserError('group_taken');
    const g = await db.userGroup.create({ data: { key, name } });
    await audit(db, r.adminId, 'create_group', null, name);
    return g;
  });
}

export async function addToGroup(prisma: PrismaClient, r: { adminId: number; groupId: number; userId: number }) {
  return withTx(prisma, async (db) => {
    if (!(await db.user.findUnique({ where: { id: r.userId }, select: { id: true } }))) throw new UserError('no_member');
    await db.groupMember.upsert({ where: { groupId_userId: { groupId: r.groupId, userId: r.userId } }, create: { groupId: r.groupId, userId: r.userId }, update: {} });
    await audit(db, r.adminId, 'group_add', null, `group ${r.groupId}, user ${r.userId}`);
  });
}

export async function removeFromGroup(prisma: PrismaClient, r: { adminId: number; groupId: number; userId: number }) {
  return withTx(prisma, async (db) => {
    await db.groupMember.deleteMany({ where: { groupId: r.groupId, userId: r.userId } });
    await audit(db, r.adminId, 'group_remove', null, `group ${r.groupId}, user ${r.userId}`);
  });
}
