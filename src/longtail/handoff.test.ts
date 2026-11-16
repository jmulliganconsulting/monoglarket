import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { callbackUrl, exchangeCode, HANDOFF_TTL_MS, issueCode, secretMatches } from './handoff.ts';

let db: PrismaClient;
let drop: () => Promise<void>;
before(async () => ({ prisma: db, drop } = await testPrisma()));
after(() => drop());

const client = { id: 'longtail', secret: 's'.repeat(40), url: 'https://tail.example.test/' };

test('callbackUrl and secretMatches', () => {
	assert.equal(callbackUrl(client), 'https://tail.example.test/auth/callback');
	assert.equal(secretMatches('s'.repeat(40), client), true);
	assert.equal(secretMatches('s'.repeat(39), client), false);
	assert.equal(secretMatches('', client), false);
});

test('a code works once, for its member, and only before it expires', async () => {
	const mod = await db.user.create({ data: { email: 'mod@example.test', displayName: 'Mod', role: 'moderator' } });
	const member = await db.user.create({ data: { email: 'm@example.test', displayName: 'Member', role: 'member' } }); // never onboarded: still fine
	const now = new Date('2026-11-13T12:00:00Z');

	const code = await issueCode(db, mod.id, now);
	assert.equal(await db.handoffCode.count({ where: { codeHash: code } }), 0); // raw code never stored
	assert.deepEqual(await exchangeCode(db, code, now), { userId: mod.id, displayName: 'Mod', isAdmin: true });
	assert.equal(await exchangeCode(db, code, now), null); // spent

	const late = await issueCode(db, member.id, now);
	assert.equal(await exchangeCode(db, late, new Date(now.getTime() + HANDOFF_TTL_MS)), null); // expired

	const ok = await issueCode(db, member.id, now);
	assert.deepEqual(await exchangeCode(db, ok, new Date(now.getTime() + HANDOFF_TTL_MS - 1)), { userId: member.id, displayName: 'Member', isAdmin: false });
	assert.equal(await exchangeCode(db, 'made-up', now), null);

	// Two exchanges racing for one code: exactly one wins.
	const race = await issueCode(db, member.id, now);
	const results = await Promise.all([exchangeCode(db, race, now), exchangeCode(db, race, now)]);
	assert.equal(results.filter(Boolean).length, 1);
});
