import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { connectAccount, disconnectAccount, linkManually, sseMemberForEmail, unlinkAccount } from './accounts.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
before(async () => {
	({ prisma: pool, drop } = await testPrisma());
	const now = new Date();
	for (const [id, email] of [[1, 'ana@g.rit.edu'], [2, 'ben@rit.edu']] as const) await pool.sseMember.create({ data: { id, email, name: email, membershipFetchedAt: now, syncedAt: now } });
});
after(() => drop());

test('matches @rit.edu users to @g.rit.edu SSE rows and back', async () => {
	assert.equal((await sseMemberForEmail(pool, 'Ana@rit.edu'))?.id, 1);
	assert.equal((await sseMemberForEmail(pool, 'ana@g.rit.edu'))?.id, 1);
	assert.equal((await sseMemberForEmail(pool, 'ben@rit.edu'))?.id, 2);
	assert.equal(await sseMemberForEmail(pool, 'cy@rit.edu'), null);
});

test('connect, reconnect, taken, no member, disconnect', async () => {
	assert.equal(await connectAccount(pool, 'ana@rit.edu', 'linkedInId', 'li-ana'), 'connected');
	assert.equal(await connectAccount(pool, 'ana@rit.edu', 'linkedInId', 'li-ana'), 'connected');
	assert.equal(await connectAccount(pool, 'ben@rit.edu', 'linkedInId', 'li-ana'), 'taken');
	assert.equal(await connectAccount(pool, 'cy@rit.edu', 'linkedInId', 'li-cy'), 'no_member');
	assert.equal((await pool.sseMember.findUnique({ where: { id: 1 } }))?.linkedInId, 'li-ana');
	await disconnectAccount(pool, 'ana@rit.edu', 'linkedInId');
	assert.equal((await pool.sseMember.findUnique({ where: { id: 1 } }))?.linkedInId, null);
	assert.equal(await connectAccount(pool, 'ben@rit.edu', 'linkedInId', 'li-ana'), 'connected');
	// Accounts are independent: Ben's Discord doesn't touch his LinkedIn.
	assert.equal(await connectAccount(pool, 'ben@rit.edu', 'discordId', '80351110224678912'), 'connected');
	assert.equal(await connectAccount(pool, 'ana@rit.edu', 'discordId', '80351110224678912'), 'taken');
	assert.deepEqual(await pool.sseMember.findUnique({ where: { id: 2 }, select: { linkedInId: true, discordId: true } }), { linkedInId: 'li-ana', discordId: '80351110224678912' });
	// GitHub stores the username alongside the id, and unlinking clears both.
	assert.equal(await connectAccount(pool, 'ben@rit.edu', 'gitHubLinkedId', '583231', { gitHubLinkedLogin: 'octocat' }), 'connected');
	assert.equal(await connectAccount(pool, 'ana@rit.edu', 'gitHubLinkedId', '583231', { gitHubLinkedLogin: 'octocat' }), 'taken');
	assert.deepEqual(await pool.sseMember.findUnique({ where: { id: 2 }, select: { gitHubLinkedId: true, gitHubLinkedLogin: true, gitHubLinkedVia: true } }), { gitHubLinkedId: '583231', gitHubLinkedLogin: 'octocat', gitHubLinkedVia: 'oauth' });
	await disconnectAccount(pool, 'ben@rit.edu', 'gitHubLinkedId');
	assert.deepEqual(await pool.sseMember.findUnique({ where: { id: 2 }, select: { gitHubLinkedId: true, gitHubLinkedLogin: true, gitHubLinkedVia: true } }), { gitHubLinkedId: null, gitHubLinkedLogin: null, gitHubLinkedVia: null });
});

test('manual links: validation, taken ids, unlink', async () => {
	const m = await linkManually(pool, 1, { discordId: ' 123456789012345678 ', discordUsername: '@Ana.Codes', linkedInSlug: 'https://www.linkedin.com/in/ana-r/' });
	assert.deepEqual([m.discordId, m.discordUsername, m.discordLinkedVia, m.resolvedLinkedIn, m.linkedInSlugManual, m.linkedInValid], ['123456789012345678', 'ana.codes', 'manual', 'ana-r', 'ana-r', true]);
	await assert.rejects(linkManually(pool, 1, { discordId: 'ana#1234' }), /17-20 digit/);
	await assert.rejects(linkManually(pool, 1, { discordUsername: 'has space' }), /isn't a Discord username/);
	await assert.rejects(linkManually(pool, 1, { linkedInSlug: 'Ana Rivera' }), /isn't a LinkedIn/);
	await assert.rejects(linkManually(pool, 2, { discordId: '123456789012345678' }), /already linked to SSE user 1/);
	await unlinkAccount(pool, 1, 'discordId');
	const after = await pool.sseMember.findUniqueOrThrow({ where: { id: 1 } });
	assert.deepEqual([after.discordId, after.discordUsername, after.discordLinkedVia, after.linkedInSlugManual], [null, null, null, 'ana-r']);
});
