import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { CODE_TTL_MS, getSession, googleSignIn, passwordLogin, requestLogin, setPassword, signOut, verifyCode, verifyLink, type Allowlist } from './auth.ts';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coin: number;
const allow: Allowlist = { domains: ['school.test'], emails: ['guest@gmail.test'] };

before(async () => {
	({ prisma, drop } = await testPrisma());
	coin = (await prisma.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal', signupGrant: 1000 } })).id;
});
after(() => drop());

const walletOf = async (userId: number) =>
	(await prisma.account.findUnique({ where: { ownerType_ownerId_currencyId: { ownerType: 'user', ownerId: userId, currencyId: coin } } }))?.balance ?? 0;

test('code sign-in creates the member once and grants nothing until onboarding', async () => {
	const { code } = await requestLogin(prisma, '  Ana@School.test ', allow);
	const first = await verifyCode(prisma, 'ana@school.test', code);
	assert.equal(first.user.email, 'ana@school.test');
	assert.equal(await walletOf(first.user.id), 0); // signup grant comes on the last onboarding screen

	const again = await requestLogin(prisma, 'ana@school.test', allow);
	const second = await verifyCode(prisma, 'ana@school.test', again.code);
	assert.equal(second.user.id, first.user.id);
	assert.equal(await walletOf(first.user.id), 0); // no grant on sign-in: the signup grant is paid on the last onboarding screen
});

test('codes are single use and die after 5 wrong tries', async () => {
	const { code } = await requestLogin(prisma, 'ben@school.test', allow);
	const wrong = code === '000000' ? '111111' : '000000';
	for (let i = 0; i < 5; i++) await assert.rejects(verifyCode(prisma, 'ben@school.test', wrong), { code: 'wrong_code' });
	await assert.rejects(verifyCode(prisma, 'ben@school.test', code), { code: 'code_expired' });

	const fresh = await requestLogin(prisma, 'ben@school.test', allow);
	await verifyCode(prisma, 'ben@school.test', fresh.code);
	await assert.rejects(verifyCode(prisma, 'ben@school.test', fresh.code), { code: 'code_expired' });
});

test('link sign-in works once, and not after expiry', async () => {
	const { link } = await requestLogin(prisma, 'guest@gmail.test', allow);
	const { user } = await verifyLink(prisma, link);
	assert.equal(user.email, 'guest@gmail.test');
	await assert.rejects(verifyLink(prisma, link), { code: 'link_expired' });

	const old = await requestLogin(prisma, 'cy@school.test', allow, new Date(Date.now() - CODE_TTL_MS - 1000));
	await assert.rejects(verifyLink(prisma, old.link), { code: 'link_expired' });
});

test('allowlist, email validation and rate limit', async () => {
	await assert.rejects(requestLogin(prisma, 'eve@elsewhere.test', allow), { code: 'not_allowed' });
	await assert.rejects(requestLogin(prisma, 'not an email', allow), { code: 'bad_email' });
	for (let i = 0; i < 5; i++) await requestLogin(prisma, 'dee@school.test', allow);
	await assert.rejects(requestLogin(prisma, 'dee@school.test', allow), { code: 'too_many_requests' });
});

test('sessions: lookup, sliding renewal, sign out', async () => {
	const { code } = await requestLogin(prisma, 'eli@school.test', allow);
	const { session, user } = await verifyCode(prisma, 'eli@school.test', code);
	assert.equal((await getSession(prisma, session))?.user.id, user.id);
	assert.equal(await getSession(prisma, 'forged-token'), null);

	// 20 days later the session is past halfway, so it gets pushed out again
	const later = new Date(Date.now() + 20 * 86_400_000);
	const renewed = await getSession(prisma, session, later);
	assert.ok(renewed && renewed.expiresAt.getTime() > later.getTime() + 29 * 86_400_000);

	await signOut(prisma, session);
	assert.equal(await getSession(prisma, session), null);
});

test('Google sign-in creates the member, then a set password signs in and old sessions end', async () => {
	await assert.rejects(googleSignIn(prisma, 'eve@elsewhere.test', allow), { code: 'not_allowed' });
	const first = await googleSignIn(prisma, 'Gus@School.test', allow);
	assert.equal(first.user.email, 'gus@school.test');
	assert.equal(await walletOf(first.user.id), 0); // signup grant comes on the last onboarding screen
	const other = await googleSignIn(prisma, 'gus@school.test', allow);
	assert.equal(other.user.id, first.user.id);

	await assert.rejects(passwordLogin(prisma, 'gus@school.test', 'whatever1'), { code: 'wrong_password' }); // none set yet
	await assert.rejects(setPassword(prisma, first.user.id, 'short'), { code: 'weak_password' });
	await setPassword(prisma, first.user.id, 'correct horse', first.session);
	assert.equal(await getSession(prisma, other.session), null);
	assert.ok(await getSession(prisma, first.session));

	const { user } = await passwordLogin(prisma, ' GUS@school.test', 'correct horse');
	assert.equal(user.id, first.user.id);
	await assert.rejects(passwordLogin(prisma, 'gus@school.test', 'wrong horse'), { code: 'wrong_password' });
	await assert.rejects(passwordLogin(prisma, 'nobody@school.test', 'correct horse'), { code: 'wrong_password' });
});

test('password sign-in locks after 10 failures', async () => {
	const { user } = await googleSignIn(prisma, 'hal@school.test', allow);
	await setPassword(prisma, user.id, 'right password');
	for (let i = 0; i < 10; i++) await assert.rejects(passwordLogin(prisma, 'hal@school.test', 'nope'), { code: 'wrong_password' });
	await assert.rejects(passwordLogin(prisma, 'hal@school.test', 'right password'), { code: 'too_many_requests' });
});

test('the primary officer badge is given on sign-in and kept after the role ends', async () => {
	const now = new Date();
	const member = await prisma.sseMember.create({ data: { id: 900, email: 'pat@school.test', name: 'Pat', membershipFetchedAt: now, syncedAt: now } });
	await prisma.sseOfficer.create({ data: { sseOfficerId: 900, memberId: member.id, title: 'President', isPrimary: true, isActive: true } });
	const given = await verifyCode(prisma, 'pat@school.test', (await requestLogin(prisma, 'pat@school.test', allow)).code);
	assert.ok(given.user.primaryOfficerSince);

	await prisma.sseOfficer.update({ where: { sseOfficerId: 900 }, data: { isActive: false, removedAt: new Date() } });
	const kept = await verifyCode(prisma, 'pat@school.test', (await requestLogin(prisma, 'pat@school.test', allow)).code);
	assert.equal(kept.user.primaryOfficerSince?.getTime(), given.user.primaryOfficerSince?.getTime());
});
