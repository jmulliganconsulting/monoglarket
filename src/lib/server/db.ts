import { createPrisma, type PrismaClient } from '../../db/db.ts';

// One client per server process; reused across Vite dev reloads so connections don't pile up.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = (g.prisma ??= createPrisma());
