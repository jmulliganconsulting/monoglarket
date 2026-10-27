// A people market: each option is an SSE member, labelled by their name and linked to their SSE row (no site login needed).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { createMarket, grant } from './markets.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, ana: number, sseAna: number, sseBo: number;

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  ana = (await pool.user.create({ data: { displayName: 'Ana Lopez', preferredName: 'Ana', email: 'ana@rit.edu', role: 'creator' } })).id;
  const synced = { membershipFetchedAt: new Date(), syncedAt: new Date() };
  sseAna = (await pool.sseMember.create({ data: { id: 1, email: 'ana@g.rit.edu', name: 'Ana Lopez', imageFile: 'ana.png', ...synced } })).id;
  sseBo = (await pool.sseMember.create({ data: { id: 2, email: 'bo@g.rit.edu', name: 'Bo Chen', ...synced } })).id;
  for (const id of [mod, ana]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('each option is linked to its SSE member; a site login sets the name, otherwise the SSE name is used', async () => {
  const id = await createMarket(pool, {
    question: 'Who will win the election?',
    criteria: 'The certified result',
    currencyId: coin,
    outcomes: ['Ana', 'Bo Chen'],
    outcomeSseMemberIds: [sseAna, sseBo],
    subsidy: 70,
    closeAt: new Date(Date.now() + 86_400_000),
    creatorId: mod,
  });
  const outcomes = await pool.outcome.findMany({ where: { marketId: id }, orderBy: { sort: 'asc' } });
  assert.deepEqual(
    outcomes.map((o) => [o.label, o.sseMemberId]),
    [
      ['Ana', sseAna],
      ['Bo Chen', sseBo],
    ],
  );
});
