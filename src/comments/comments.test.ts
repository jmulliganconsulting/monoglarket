// Market comments (FR-13): length, approved markets only, a per-minute limit, and moderators hide with an audit trail.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, createMarket, grant } from '../markets/markets.ts';
import { COMMENTS_PER_MINUTE, hideComment, postComment } from './comments.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, ben: number, openId: number, pendingId: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana', role: 'creator' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'creator' } })).id;
  const closeAt = new Date(Date.now() + 86_400_000);
  openId = await createMarket(pool, { question: 'Open?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 10, closeAt });
  await approveMarket(pool, { marketId: openId, moderatorId: mod });
  pendingId = await createMarket(pool, { question: 'Pending?', criteria: 'C', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 10, closeAt });
});
after(() => drop());

test('a comment needs 1 to 500 characters and an approved market', async () => {
  await assert.rejects(postComment(pool, { marketId: openId, userId: ana, body: '   ' }), { code: 'comment_length' });
  await assert.rejects(postComment(pool, { marketId: openId, userId: ana, body: 'x'.repeat(501) }), { code: 'comment_length' });
  await assert.rejects(postComment(pool, { marketId: pendingId, userId: ana, body: 'Hi' }), { code: 'comment_closed' });
  const c = await postComment(pool, { marketId: openId, userId: ana, body: '  I think yes  ' });
  assert.equal(c.body, 'I think yes');
});

test('a member can post at most 5 comments a minute', async () => {
  for (let i = 1; i <= COMMENTS_PER_MINUTE; i++) await postComment(pool, { marketId: openId, userId: ben, body: `Point ${i}` });
  await assert.rejects(postComment(pool, { marketId: openId, userId: ben, body: 'One more' }), { code: 'comment_rate' });
});

test('a moderator hides a comment once; the hide is audited and the comment stays in the table', async () => {
  const c = await pool.marketComment.findFirstOrThrow({ where: { userId: ana } });
  await hideComment(pool, { commentId: c.id, moderatorId: mod });
  const row = await pool.marketComment.findUniqueOrThrow({ where: { id: c.id } });
  assert.ok(row.hiddenAt);
  assert.equal(row.hiddenBy, mod);
  assert.equal(await pool.auditEntry.count({ where: { action: 'hide_comment', marketId: openId } }), 1);
  await assert.rejects(hideComment(pool, { commentId: c.id, moderatorId: mod }), { code: 'already_hidden' });
});
