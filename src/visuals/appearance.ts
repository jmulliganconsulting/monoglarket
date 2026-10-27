// Saves a market's colours and pictures (vault "Market visuals"). Empty colour = default; a picture keeps the old one unless a new one is sent.
import type { PrismaClient } from '../db/db.ts';
import { withTx } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { MarketError } from '../markets/markets.ts';

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (c: string) => {
  if (c === '') return null;
  if (!HEX.test(c)) throw new MarketError('bad_colour');
  return c.toLowerCase();
};

export async function setAppearance(
  prisma: PrismaClient,
  a: { marketId: number; moderatorId: number; colorPrimary: string; colorSecondary: string; image?: string; outcomes: { id: number; color: string; image?: string }[] },
) {
  const primary = colour(a.colorPrimary);
  const secondary = colour(a.colorSecondary);
  const outcomes = a.outcomes.map((o) => ({ id: o.id, color: colour(o.color), image: o.image }));
  return withTx(prisma, async (db) => {
    const market = await db.market.findUnique({ where: { id: a.marketId }, select: { id: true } });
    if (!market) throw new MarketError('not_found');
    await db.market.update({ where: { id: a.marketId }, data: { colorPrimary: primary, colorSecondary: secondary, ...(a.image ? { imageFile: a.image } : {}) } });
    for (const o of outcomes)
      await db.outcome.updateMany({ where: { id: o.id, marketId: a.marketId }, data: { color: o.color, ...(o.image ? { imageFile: o.image } : {}) } });
    await audit(db, a.moderatorId, 'appearance', a.marketId, '');
  });
}
