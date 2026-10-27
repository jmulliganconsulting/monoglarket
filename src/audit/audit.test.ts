// Every state-changing action writes an audit row (NFR-07). These check the actions a member, a moderator or an admin takes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, buy, createMarket, createQuestionGroup, grant, propose, sell } from '../markets/markets.ts';
import { postComment } from '../comments/comments.ts';
import { setSetting } from '../settings/settings.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, admin: number, ana: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const actions = (marketId: number) => pool.auditEntry.findMany({ where: { marketId }, orderBy: { id: 'asc' }, select: { action: true, actorId: true } });

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator', onboardedAt: new Date() } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'member', onboardedAt: new Date() } })).id;
  for (const id of [mod, admin, ana, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('creating, approving, trading and commenting each leave a row naming who did it', async () => {
  const marketId = await createMarket(pool, { question: 'Snow?', criteria: 'Weather service', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), creatorId: ana, spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const yes = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 0 } })).id;
  await buy(pool, { userId: ben, marketId, outcomeId: yes, spend: 20, minShares: 0, idempotencyKey: 'audit-buy' });
  await sell(pool, { userId: ben, marketId, outcomeId: yes, shares: 'all', minProceeds: 0, idempotencyKey: 'audit-cash' });
  await postComment(pool, { marketId, userId: ben, body: 'Hope it snows' });

  const rows = await actions(marketId);
  assert.deepEqual(rows.map((r) => r.action), ['create_market', 'approve', 'buy', 'sell', 'comment']);
  assert.equal(rows[0].actorId, ana);
  assert.equal(rows[2].actorId, ben);
});

test('a question with several winners records its creation, with no single market attached', async () => {
  await createQuestionGroup(pool, { question: 'Which teams make playoffs?', criteria: 'Standings', currencyId: coin, options: ['A', 'B'], subsidy: 70, closeAt: tomorrow(), creatorId: ana, spendCap: 100000 });
  const row = await pool.auditEntry.findFirstOrThrow({ where: { action: 'create_question' }, orderBy: { id: 'desc' } });
  assert.equal(row.marketId, null);
  assert.equal(row.actorId, ana);
});

test('a member who is not trusted with a market leaves no proposal and no proposal row', async () => {
  const marketId = await createMarket(pool, { question: 'Rain?', criteria: 'Weather service', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const no = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 1 } })).id;
  await assert.rejects(propose(pool, { marketId, outcomeId: no, proposerId: ben, evidence: 'my guess' }), { code: 'not_allowed' });
  assert.equal(await pool.resolutionProposal.count({ where: { marketId } }), 0);
});

test('a setting change is recorded against the admin who made it', async () => {
  await setSetting(pool, 'decided_home_hours', '12', admin);
  const row = await pool.auditEntry.findFirstOrThrow({ where: { action: 'setting' }, orderBy: { id: 'desc' } });
  assert.equal(row.actorId, admin);
  assert.equal(row.detail, 'decided_home_hours = 12');
});
