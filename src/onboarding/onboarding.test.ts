import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type PrismaClient } from '../db/db.ts';
import { googleSignIn, type Allowlist } from '../auth/auth.ts';
import { testPrisma } from '../test-db.ts';
import { PROGRAMS } from '../sse/majors.ts';
import { finishOnboarding, saveEligibility, saveName, saveSchool, advanceFrom, screenFor } from './onboarding.ts';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coin: number;
const allow: Allowlist = { domains: ['school.test'], emails: [] };
const adult = { birthYear: 1999, birthMonth: null, birthDay: null, country: 'US', state: 'NY', accepted: true };
const name = (username: string, extra = {}) => ({ prefix: '', firstName: 'Ana', middleName: '', lastName: 'Lee', suffix: '', preferredName: '', username, pronouns: '', pronounsPublic: false, ...extra });
const walletOf = async (userId: number) =>
	(await prisma.account.findUnique({ where: { ownerType_ownerId_currencyId: { ownerType: 'user', ownerId: userId, currencyId: coin } } }))?.balance ?? 0;
const newUser = (email: string) => prisma.user.create({ data: { email, displayName: email.split('@')[0] } });

before(async () => {
	({ prisma, drop } = await testPrisma());
	coin = (await prisma.currency.create({ data: { code: 'DBLN', name: 'Dabloons', kind: 'internal', signupGrant: 1000 } })).id;
});
after(() => drop());

test('under 18 is blocked: account deleted, block kept, every sign-in refused', async () => {
	const u = await newUser('kid@school.test');
	const r = await saveEligibility(prisma, u.id, { ...adult, birthYear: 2012 });
	assert.equal(r, 'blocked');
	assert.equal(await prisma.user.findUnique({ where: { id: u.id } }), null);
	assert.equal((await prisma.signupBlock.findFirst({ where: { email: 'kid@school.test' } }))?.reason, 'under_18');
	await assert.rejects(googleSignIn(prisma, 'kid@school.test', allow), { code: 'blocked' });
});

test('exactly 18 needs a month and day, then the birthday decides', async () => {
	const u = await newUser('eighteen@school.test');
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, birthYear: 2008 }), { code: 'birth_month_day_required' });
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, birthYear: 2008, birthMonth: 2, birthDay: 30 }), { code: 'birth_date_invalid' });
	assert.equal(await saveEligibility(prisma, u.id, { ...adult, birthYear: 2008, birthMonth: 1, birthDay: 2 }), 'ok');
});

test('state is required from the US list; city is optional and saved when given', async () => {
	const u = await newUser('state@school.test');
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, state: '' }), { code: 'state_required' });
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, state: 'ZZ' }), { code: 'state_required' });
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, birthYear: 2009, birthMonth: 2, birthDay: 29 }), { code: 'birth_date_invalid' });
	assert.equal(await saveEligibility(prisma, u.id, { ...adult, city: '  Rochester ' }), 'ok');
	const saved = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
	assert.deepEqual([saved.state, saved.city], ['NY', 'Rochester']);
});

test('Canada: province optional but checked; other countries: no state needed; typed US or Canada names get the same rules', async () => {
	const ca = await newUser('ca@school.test');
	await assert.rejects(saveEligibility(prisma, ca.id, { ...adult, country: 'CA', state: 'ZZ' }), { code: 'state_invalid' });
	assert.equal(await saveEligibility(prisma, ca.id, { ...adult, country: 'CA', state: '' }), 'ok');
	assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ca.id } })).country, 'CA');
	const uk = await newUser('uk@school.test');
	assert.equal(await saveEligibility(prisma, uk.id, { ...adult, country: 'United Kingdom', state: '' }), 'ok');
	const typed = await newUser('typed@school.test');
	await assert.rejects(saveEligibility(prisma, typed.id, { ...adult, country: 'U.S.A.', state: '' }), { code: 'state_required' });
});

test('screens run in order and resume where they stopped', async () => {
	const u = await newUser('ana@school.test');
	assert.equal(screenFor(u), 'eligibility');
	await assert.rejects(saveName(prisma, u.id, name('ana')), { code: 'out_of_order' });
	await assert.rejects(saveEligibility(prisma, u.id, { ...adult, accepted: false }), { code: 'terms_required' });
	assert.equal(await saveEligibility(prisma, u.id, adult), 'ok');
	assert.equal(screenFor(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })), 'name');
});

test('names: reserved and taken usernames are refused, the username is saved lowercase', async () => {
	const [a, b] = await Promise.all([newUser('nm1@school.test'), newUser('nm2@school.test')]);
	await saveEligibility(prisma, a.id, adult);
	await saveEligibility(prisma, b.id, adult);
	await assert.rejects(saveName(prisma, a.id, name('Admin')), { code: 'username_reserved' });
	await assert.rejects(saveName(prisma, a.id, name('x')), { code: 'username_invalid' });
	await saveName(prisma, a.id, name('Ana_Lee'));
	const row = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
	assert.equal(row.username, 'ana_lee');
	assert.equal(row.preferredName, 'Ana Lee');
	assert.equal(row.displayName, 'Ana Lee');
	await assert.rejects(saveName(prisma, b.id, name('ANA_LEE')), { code: 'username_taken' });
});

test('school: current students need a level and a major; majors come from the list', async () => {
	const u = await prisma.user.findFirstOrThrow({ where: { username: 'ana_lee' } });
	const major = `${PROGRAMS[0][0]}|${PROGRAMS[0][1]}`;
	await assert.rejects(saveSchool(prisma, u.id, { status: 'current', seniority: '', onCoopTerm: false, isTransfer: false, programs: [major], graduationTerm: '', graduationYear: null }), { code: 'seniority_required' });
	await assert.rejects(saveSchool(prisma, u.id, { status: 'current', seniority: 'third', onCoopTerm: false, isTransfer: false, programs: [], graduationTerm: '', graduationYear: null }), { code: 'program_required' });
	await assert.rejects(saveSchool(prisma, u.id, { status: 'current', seniority: 'third', onCoopTerm: false, isTransfer: false, programs: ['Made Up|BS'], graduationTerm: '', graduationYear: null }), { code: 'program_invalid' });
	await saveSchool(prisma, u.id, { status: 'current', seniority: 'third', onCoopTerm: true, isTransfer: false, programs: [major, major], graduationTerm: 'FALL', graduationYear: 2028 });
	const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { programs: true } });
	assert.equal(row.seniority, 'third');
	assert.equal(row.onCoopTerm, true);
	assert.equal(row.programs.length, 1); // duplicates collapse
	assert.equal(row.onboardingStep, 3);
});

test('status and optional screens advance; the grant is paid only on the last screen', async () => {
	const u = await prisma.user.findFirstOrThrow({ where: { username: 'ana_lee' } });
	await advanceFrom(prisma, u.id, 3);
	await advanceFrom(prisma, u.id, 4);
	assert.equal(await walletOf(u.id), 0);
	await finishOnboarding(prisma, u.id);
	assert.equal(await walletOf(u.id), 1000);
	assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).onboardedAt);
	assert.equal(screenFor(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })), null);
	await assert.rejects(finishOnboarding(prisma, u.id), { code: 'out_of_order' });
	assert.equal(await walletOf(u.id), 1000); // never twice
});

test('an alum may skip majors, and no major list is needed', async () => {
	const u = await newUser('alum@school.test');
	await saveEligibility(prisma, u.id, adult);
	await saveName(prisma, u.id, name('alum_ana'));
	await saveSchool(prisma, u.id, { status: 'alum', seniority: '', onCoopTerm: false, isTransfer: false, programs: [], graduationTerm: 'SPRING', graduationYear: 2020 });
	assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).seniority, null);
});

test('an onboarded member cannot run the screens again', async () => {
	const u = await prisma.user.findFirstOrThrow({ where: { username: 'ana_lee' } });
	await assert.rejects(saveEligibility(prisma, u.id, adult), { code: 'out_of_order' });
	await assert.rejects(saveName(prisma, u.id, name('ana_again')), { code: 'out_of_order' });
});
