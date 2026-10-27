// Resolution proof (vault "Resolution proof"): https links only, pictures and PDFs checked by signature, and a proposal keeps its proof.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { approveMarket, createMarket, grant, propose } from '../markets/markets.ts';
import { grantResolver } from '../markets/markets.ts';
import { isHttpsUrl, looksLikeProof, parseLinks } from './proofs.ts';
import { linkify } from '../lib/linkify.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let coin: number, mod: number, admin: number, ben: number;
const tomorrow = () => new Date(Date.now() + 86_400_000);

before(async () => {
  ({ prisma: pool, drop } = await testPrisma());
  coin = (await pool.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal' } })).id;
  mod = (await pool.user.create({ data: { displayName: 'Mod', role: 'moderator' } })).id;
  admin = (await pool.user.create({ data: { displayName: 'Admin', role: 'admin' } })).id;
  ben = (await pool.user.create({ data: { displayName: 'Ben', role: 'member', onboardedAt: new Date() } })).id;
  for (const id of [mod, admin, ben]) await grant(pool, id, coin, 1000, `g:${id}`);
});
after(() => drop());

test('only https links are kept; anything else is refused', () => {
  assert.equal(isHttpsUrl('https://example.com/scores'), true);
  assert.equal(isHttpsUrl('http://example.com'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.deepEqual(parseLinks('https://example.com/a | Final score\n\nhttps://example.com/b'), [
    { kind: 'link', url: 'https://example.com/a', label: 'Final score' },
    { kind: 'link', url: 'https://example.com/b', label: 'https://example.com/b' },
  ]);
  assert.throws(() => parseLinks('http://example.com'), /https/);
});

test('a picture or PDF must match its declared type by its first bytes', () => {
  assert.equal(looksLikeProof(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), 'png'), true);
  assert.equal(looksLikeProof(Buffer.from('<html>'), 'png'), false);
  assert.equal(looksLikeProof(Buffer.from('%PDF-1.7'), 'pdf'), true);
  assert.equal(looksLikeProof(Buffer.from('MZ'), 'pdf'), false);
});

test('a description keeps its links clickable and never returns markup', () => {
  assert.deepEqual(linkify('See https://example.com/x. Also <b>bold</b>'), [
    { text: 'See ' },
    { text: 'https://example.com/x', href: 'https://example.com/x' },
    { text: '.' },
    { text: ' Also <b>bold</b>' },
  ]);
});

test('a granted member proposes with links and a file, and the proof is stored with the proposal', async () => {
  const marketId = await createMarket(pool, { question: 'Bake sale?', criteria: 'Count', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  await grantResolver(pool, { marketId, userId: ben, adminId: admin });
  const no = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 1 } })).id;
  const p = await propose(pool, {
    marketId,
    outcomeId: no,
    proposerId: ben,
    evidence: 'Count sheet, see https://example.com/count',
    proofs: [
      { kind: 'link', url: 'https://example.com/count', label: 'Count page' },
      { kind: 'image', storedName: '00000000-0000-4000-8000-000000000000.png', originalName: 'sheet.png', mimeType: 'image/png', sizeBytes: 1200, label: 'sheet.png' },
    ],
  });
  const stored = await pool.resolutionAttachment.findMany({ where: { proposalId: p.id }, orderBy: { id: 'asc' } });
  assert.deepEqual(stored.map((a) => a.kind), ['link', 'image']);
  assert.equal(stored[0].url, 'https://example.com/count');
  assert.equal(stored[1].storedName, '00000000-0000-4000-8000-000000000000.png');
});

test('more than five proofs, or a non-https link, are refused before anything is saved', async () => {
  const marketId = await createMarket(pool, { question: 'Quiz?', criteria: 'Answer key', currencyId: coin, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: tomorrow(), spendCap: 100000 });
  await approveMarket(pool, { marketId, moderatorId: mod });
  const no = (await pool.outcome.findFirstOrThrow({ where: { marketId, sort: 1 } })).id;
  const link = { kind: 'link' as const, url: 'https://example.com', label: 'x' };
  await assert.rejects(propose(pool, { marketId, outcomeId: no, proposerId: mod, evidence: 'a', proofs: Array(6).fill(link) }), { code: 'too_many_proofs' });
  await assert.rejects(propose(pool, { marketId, outcomeId: no, proposerId: mod, evidence: 'a', proofs: [{ ...link, url: 'http://example.com' }] }), { code: 'bad_link' });
  assert.equal(await pool.resolutionProposal.count({ where: { marketId } }), 0);
});
