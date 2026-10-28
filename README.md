# MonoGlarket

Unofficial SSE Polymarket. Self-hosted, play-money prediction market for a school club, not affiliated with SSE, RIT, or Polymarket. SvelteKit + Prisma + Postgres. Design docs live in the Obsidian vault `~/Documents/obsidian/Club Predictions` (start at **Home**, then **Implementation plan**).

## Develop

```bash
npm install          # also generates the Prisma client
cp .env.example .env # who may sign in, email settings
npm run db:up        # Postgres 16 on localhost:5434
npm run db:deploy    # apply Prisma migrations
npm run db:seed      # optional: sample currency, members, markets
npm run dev          # http://localhost:5173
```

Needs Node 24+ and Docker. Set `PORT` in `.env` to change the dev port. Set `DATABASE_URL` to use another Postgres; `POSTGRES_PORT` moves the compose one (default `localhost:5434`, user/password `postgres`, database `clubpredict`).

**Google sign-in:** set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see `.env.example`). With both set and `GOOGLE_SIGNIN_ENABLED` not `false`, the login page leads with Google and puts email + code behind a small link; otherwise it shows email + code directly. Members can set a password at `/account`.

**Signing in locally:** use any `@example.test` address (the seeded allowlist). With no `SMTP_URL`, the code and link are printed in the `npm run dev` terminal instead of emailed. The seed gives the `DBLN` currency a 1,000-dabloon signup grant.

## Check

```bash
npm test             # engine, ledger, simulation, concurrency, sign-in (needs db:up)
npm run check        # svelte-check / TypeScript
npm run check:sqlite # schema must stay valid on SQLite too
```

## Deploy

On the server, copy `.env.example` to `.env` and set `DOMAIN`, `POSTGRES_PASSWORD`, `ALLOWED_EMAIL_DOMAINS` (your school's domain) and `SMTP_URL`/`MAIL_FROM` so sign-in emails are actually sent. `HTTP_PORT`/`HTTPS_PORT` change Caddy's host ports (default 80/443):

```bash
docker compose up -d --build
```

Starts Postgres, the app (runs `prisma migrate deploy` on start, health check at `/health`) and Caddy (automatic HTTPS for `DOMAIN`).

Nightly backup: `scripts/backup.sh` (pg_dump to `data/backups`, two weeks kept). Add it to the host's cron, e.g. `0 3 * * *`.

## Changing the schema

Edit `prisma/schema.prisma`, then `npm run db:migrate -- --name <change>`. Keep it portable: no enums, no `@db.*` types, no `Json`, no raw SQL (see ADR-014 in the vault).

## Layout

| Path | What |
|---|---|
| `src/routes/` | SvelteKit pages and endpoints (`+page.server.ts` loads data, `health/+server.ts`) |
| `src/lib/server/db.ts` | The app's shared Prisma client (server-only) |
| `src/hooks.server.ts` | Loads the signed-in member on every request; sends everyone else to `/login` |
| `src/auth/auth.ts` | Passwordless sign-in: codes, links, sessions, signup grant (framework-free, tested) |
| `src/env.ts` | Server environment variables (SvelteKit 3 `defineEnvVars`) |
| `src/lib/styles/tokens.css` | Colours, type, radii from the Polymarket reference (vault: `examples/Design reference`) |
| `src/engine/lmsr.ts` | Pure LMSR maths: prices, shares for a spend, sell proceeds, rounding |
| `src/ledger/ledger.ts` | Double-entry ledger: accounts, `postTransaction`, `checkLedger` invariants |
| `src/markets/markets.ts` | Open market, buy, sell, resolve, cancel, finalise, grant |
| `src/sse/` | SSE site mirror: members, officers, mentors, memberships, events + check-ins (`sync.ts`), location parsing (`locations.ts`), linked accounts |
| `src/earn/earn.ts` | Turns memberships, check-ins and site events into sitecurrency per `earn_rules`, audited in `earn_awards` |
| `src/db/db.ts` | Prisma client factory, `withTx` (retries version conflicts) |
| `prisma/` | Schema, migrations, seed script |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile` | Production stack |
