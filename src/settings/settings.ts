// Site settings an admin can change (stored in the `settings` table).
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';

export const DEFAULTS = { decided_home_hours: '24' } as const;
export type SettingKey = keyof typeof DEFAULTS;

export async function getSetting(prisma: PrismaClient, key: SettingKey): Promise<string> {
  return (await prisma.setting.findUnique({ where: { key }, select: { value: true } }))?.value ?? DEFAULTS[key];
}

export async function getNumberSetting(prisma: PrismaClient, key: SettingKey): Promise<number> {
  const n = Number(await getSetting(prisma, key));
  return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
}

export async function setSetting(prisma: PrismaClient, key: SettingKey, value: string, actorId: number) {
  await withTx(prisma, async (db) => {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await audit(db, actorId, 'setting', null, `${key} = ${value}`);
  });
}
