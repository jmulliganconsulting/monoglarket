import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';

export { Prisma, PrismaClient };
export type Db = Prisma.TransactionClient;

// .env -> process.env (tests and scripts don't go through Vite); real environment variables win.
try {
  process.loadEnvFile();
} catch {}

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/clubpredict';

// shortcut: Postgres adapter only; switching to SQLite swaps this for @prisma/adapter-better-sqlite3 (ADR-014).
export function createPrisma(opts: { url?: string; schema?: string } = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString: opts.url ?? DATABASE_URL }, opts.schema ? { schema: opts.schema } : undefined);
  return new PrismaClient({ adapter });
}

/** Thrown when an optimistic version check loses a race; withTx retries the whole transaction (ADR-015). */
export class RetryableConflict extends Error {}

export async function withTx<T>(prisma: PrismaClient, fn: (db: Db) => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await prisma.$transaction(fn);
    } catch (e) {
      if (!(e instanceof RetryableConflict) || i >= attempts) throw e;
    }
  }
}
