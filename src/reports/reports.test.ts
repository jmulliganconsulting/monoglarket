// Member reports and the moderator triage (vault "Signup and profile", "Moderation queue"). Blocks lifted by an admin.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, createMarket } from '../markets/markets.ts';
import { fileReport, handleReport } from './reports.ts';
import { liftBlock } from '../users/users.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let admin: number, mod: number, ana: number, marketId: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  const coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  marketId = await createMarket(pool, { question: 'Q?', criteria: 'C', currencyId: coin, outcomes: ['A', 'B'], subsidy: 10, closeAt: new Date(Date.now() + 86_400_000) });
  await approveMarket(pool, { marketId, moderatorId: mod });
});
after(() => drop());

test('a report needs a body and a known kind; a result report waits until the market is decided', async () => {
  await assert.rejects(fileReport(pool, { reporterId: ana, kind: 'market', marketId, body: 'no' }), { code: 'body_length' });
  await assert.rejects(fileReport(pool, { reporterId: ana, kind: 'rumour', marketId, body: 'Nothing like this' }), { code: 'bad_kind' });
  await assert.rejects(fileReport(pool, { reporterId: ana, kind: 'market', body: 'Wrong title' }), { code: 'market_not_found' });
  await assert.rejects(fileReport(pool, { reporterId: ana, kind: 'resolution', marketId, body: 'The result is wrong' }), { code: 'not_decided' });

  const r = await fileReport(pool, { reporterId: ana, kind: 'market', marketId, body: 'The criteria name the wrong page' });
  assert.equal(r.status, 'open');
});

test('a profile report is always about the reporter', async () => {
  const r = await fileReport(pool, { reporterId: ana, kind: 'profile', body: 'My school is listed wrong' });
  assert.equal(r.subjectId, ana);
  assert.equal(r.marketId, null);
});

test('a moderator handles a report once; upholding it leaves a trace in the audit log', async () => {
  const r = await pool.report.findFirstOrThrow({ where: { kind: 'market' } });
  await handleReport(pool, { reportId: r.id, moderatorId: mod, outcome: 'upheld', note: '  Fixed the criteria  ' });
  const done = await pool.report.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(done.status, 'upheld');
  assert.equal(done.note, 'Fixed the criteria');
  assert.equal(done.handledBy, mod);
  await assert.rejects(handleReport(pool, { reportId: r.id, moderatorId: admin, outcome: 'dismissed', note: '' }), { code: 'already_handled' });
  assert.equal(await pool.auditEntry.count({ where: { action: 'report_upheld', marketId } }), 1);
});

test('an admin lifts a signup block once, and the lift is recorded', async () => {
  const block = await pool.signupBlock.create({ data: { email: 'kid@example.com', reason: 'under_18' } });
  await liftBlock(pool, admin, block.id);
  const row = await pool.signupBlock.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(row.unblockedBy, admin);
  assert.ok(row.unblockedAt);
  await assert.rejects(liftBlock(pool, admin, block.id), { code: 'not_blocked' });
});
