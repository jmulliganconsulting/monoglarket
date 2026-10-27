// Gives each test file its own throwaway Postgres schema, migrated with the real Prisma migrations.
import { execFileSync } from 'node:child_process';
import { createPrisma, DATABASE_URL } from './db/db.ts';

export async function testPrisma() {
  const schema = `t_${process.pid}_${Date.now()}`;
  const url = new URL(DATABASE_URL);
  url.searchParams.set('schema', schema);
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  const prisma = createPrisma({ schema });
  return {
    prisma,
    async drop() {
      await prisma.$executeRawUnsafe(`drop schema "${schema}" cascade`);
      await prisma.$disconnect();
    },
  };
}
