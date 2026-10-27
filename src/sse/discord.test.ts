import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { discordAuthorizeUrl, discordTokenKey, linkDiscord, openToken, sealToken, unlinkDiscord, type DiscordApp } from './discord.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let userId: number;
before(async () => {
	({ prisma: pool, drop } = await testPrisma());
	const now = new Date();
	for (const [id, email] of [[1, 'ana@g.rit.edu'], [2, 'ben@rit.edu']] as const) await pool.sseMember.create({ data: { id, email, name: email, membershipFetchedAt: now, syncedAt: now } });
	userId = (await pool.user.create({ data: { email: 'ana@rit.edu', displayName: 'Ana' } })).id;
});
after(() => drop());

const key = randomBytes(32);
const revoked: string[] = [];
// Fake Discord: who signs in and with which connections / scopes.
const discord = (me: object, connections: object[], scope = 'identify email connections role_connections.write') =>
	({
		clientId: 'cid',
		clientSecret: 'secret',
		key,
		fetchFn: (async (input: string, init: RequestInit) => {
			const path = new URL(input).pathname.replace('/api/v10', '');
			if (path === '/oauth2/token') return Response.json({ access_token: 'acc', refresh_token: `ref-${(me as { id: string }).id}`, expires_in: 604800, scope, token_type: 'Bearer' });
			if (path === '/oauth2/token/revoke') return revoked.push(String(new URLSearchParams(String(init.body)).get('token'))), new Response('{}');
			assert.equal(new Headers(init.headers).get('authorization'), 'Bearer acc');
			if (path === '/users/@me') return Response.json(me);
			if (path === '/users/@me/connections') return Response.json(connections);
			return new Response('nope', { status: 404 });
		}) as unknown as typeof fetch,
	}) satisfies DiscordApp;

const ana = { id: '80351110224678912', username: 'ana.codes', global_name: 'Ana', avatar: 'abc', email: 'ana@gmail.com', verified: true, mfa_enabled: true, premium_type: 0, flags: 0, public_flags: 0, locale: 'en-US' };
const gh = { type: 'github', id: '583231', name: 'octocat', verified: true, visibility: 1, friend_sync: false, show_activity: true, two_way_link: false };
const steam = { type: 'steam', id: '7656', name: 'ana_steam', verified: true, visibility: 0 };
const link = (app: DiscordApp, email = 'ana@rit.edu') => linkDiscord(pool, app, { userId, email, code: 'c', redirectUri: 'https://x.test/account/discord/callback' });

test('authorize URL asks for every scope', () => {
	const u = new URL(discordAuthorizeUrl('cid', 'https://x.test/cb', 'st'));
	assert.equal(u.searchParams.get('scope'), 'identify email connections role_connections.write');
	assert.equal(discordTokenKey(key.toString('base64'))?.length, 32);
	assert.equal(discordTokenKey('short'), null);
	assert.equal(openToken(key, sealToken(key, 'secret-token')), 'secret-token');
	assert.throws(() => openToken(randomBytes(32), sealToken(key, 'x')));
});

test('link stores profile, sealed tokens, connections; relink flags removed connections; unlink revokes', async () => {
	assert.equal(await link(discord(ana, [gh, steam])), 'connected');
	const acc = await pool.discordAccount.findUniqueOrThrow({ where: { id: ana.id }, include: { connections: { orderBy: { type: 'asc' } } } });
	assert.deepEqual([acc.username, acc.globalName, acc.email, acc.emailVerified, acc.memberId, acc.scopes], ['ana.codes', 'Ana', 'ana@gmail.com', true, 1, 'identify email connections role_connections.write']);
	assert.notEqual(acc.refreshToken, 'ref-80351110224678912');
	assert.equal(openToken(key, acc.refreshToken!), 'ref-80351110224678912');
	assert.deepEqual(acc.connections.map((c) => [c.type, c.name, c.removedAt]), [['github', 'octocat', null], ['steam', 'ana_steam', null]]);
	assert.deepEqual(await pool.sseMember.findUnique({ where: { id: 1 }, select: { discordId: true, discordUsername: true, discordLinkedVia: true } }), { discordId: ana.id, discordUsername: 'ana.codes', discordLinkedVia: 'oauth' });

	// Relink without Steam, and without the email scope.
	await link(discord(ana, [gh], 'identify connections role_connections.write'));
	const again = await pool.discordAccount.findUniqueOrThrow({ where: { id: ana.id }, include: { connections: { orderBy: { type: 'asc' } } } });
	assert.deepEqual(again.connections.map((c) => [c.type, !!c.removedAt]), [['github', false], ['steam', true]]);
	assert.equal(again.email, null);

	// Someone else tries Ana's Discord: refused and the new token revoked.
	assert.equal(await link(discord(ana, []), 'ben@rit.edu'), 'taken');
	assert.deepEqual(revoked, ['ref-80351110224678912']);

	revoked.length = 0;
	await unlinkDiscord(pool, discord(ana, []), 'ana@rit.edu');
	assert.deepEqual(revoked, ['ref-80351110224678912']);
	const gone = await pool.discordAccount.findUniqueOrThrow({ where: { id: ana.id } });
	assert.deepEqual([gone.refreshToken, gone.accessToken, !!gone.unlinkedAt], [null, null, true]);
	assert.equal((await pool.sseMember.findUnique({ where: { id: 1 } }))?.discordId, null);
});

test('not on SSE: nothing stored, token revoked', async () => {
	revoked.length = 0;
	assert.equal(await link(discord({ ...ana, id: '111111111111111111', username: 'cy' }, []), 'cy@rit.edu'), 'no_member');
	assert.equal(await pool.discordAccount.count({ where: { id: '111111111111111111' } }), 0);
	assert.deepEqual(revoked, ['ref-111111111111111111']);
});
