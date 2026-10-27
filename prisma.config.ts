import { defineConfig } from 'prisma/config';

// .env -> process.env for DATABASE_URL; real environment variables win.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Local docker-compose Postgres unless DATABASE_URL is set.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/clubpredict' },
});
