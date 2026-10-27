import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { ritTermCode, saveImage } from './resolve.ts';
import { driveImage, politeFetch, sseMemberByEmail, syncSse, termOf, termsServed, type SyncOptions } from './sync.ts';

let pool: PrismaClient;
let drop: () => Promise<void>;
let imageDir: string;
before(async () => {
	({ prisma: pool, drop } = await testPrisma());
	imageDir = await mkdtemp(join(tmpdir(), 'sse-images-'));
});
after(async () => {
	await drop();
	await rm(imageDir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const calls: string[] = [];
// Fake internet: SSE site + GitHub + RIT + image hosts, keyed by host+path. undefined body = HTTP 500.
const net = (routes: Record<string, unknown>) =>
	(async (input: URL | string) => {
		const url = new URL(input);
		calls.push(url.host + url.pathname);
		const body = routes[url.host + url.pathname];
		if (body === undefined) return new Response('down', { status: 500 });
		if (body === 404) return new Response('missing', { status: 404 });
		if (body instanceof Uint8Array) return new Response(new Blob([body as Uint8Array<ArrayBuffer>]), { headers: { 'content-type': 'image/png' } });
		return Response.json(body);
	}) as unknown as typeof fetch;

const user = (id: number, email: string, extra: object = {}) => ({ id, name: `U${id}`, email, membershipCount: 0, ...extra });
const sse = {
	'sse.test/api/user': [
		user(1, 'Pres@G.RIT.edu', { membershipCount: 3, gitHub: 'https://github.com/octocat/hello-world', linkedIn: 'linkedin.com/in/Pres-1', major: 'Software Engineering BS / CS MS', graduationTerm: 'SPRING', graduationYear: 2028, image: '/api/aws/image?key=a.png' }),
		user(2, 'mentor@rit.edu', { membershipCount: 1, gitHub: 'ghost-user-404', linkedIn: 'Taveon Cameron', description: '  hello \r\n\r\n\r\n world ' }),
		user(3, 'member@rit.edu', { membershipCount: 2, image: 'https://cdn.test/cat.png' }),
		user(4, 'guest@rit.edu', { gitHub: '' }),
		user(5, 'oldmentor@rit.edu', { image: 'https://cdn.test/gone.png' }),
	],
	'sse.test/api/officer': [
		{ id: 10, is_active: true, start_date: '2026-08-01', end_date: '2027-05-31', user: { id: 1 }, position: { id: 1, title: 'President', is_primary: true } },
		{ id: 9, is_active: false, start_date: '2026-01-12', end_date: '2026-05-01', user: { id: 1 }, position: { id: 3, title: 'Tech Head', is_primary: false } },
		// A retired position, not on /api/officer-positions.
		{ id: 8, is_active: false, start_date: '2021-01-18', end_date: '2021-05-31', user: { id: 1 }, position: { id: 31, title: 'Winterball Head', is_primary: false } },
	],
	'sse.test/api/officer-positions': [
		{ id: 1, title: 'President', is_primary: true, category: 'PRIMARY_OFFICER', is_defunct: false, email: 'sse-president@rit.edu', isFilled: true, currentOfficer: { id: 10, userId: 1 } },
		{ id: 3, title: 'Tech Head', is_primary: false, category: 'COMMITTEE_HEAD', is_defunct: false, email: 'sse-tech@rit.edu', isFilled: false, currentOfficer: null },
	],
	'sse.test/api/mentor': [
		{ id: 35, isActive: true, expirationDate: '2027-05-01', user: { id: 2 }, latestMentorApplication: { id: 37, discordUsername: 'abigailjc', previousSemesters: 2, coursesJson: '["GCIS-123"]', status: 'pending', createdAt: '2026-08-20T01:36:21.989Z', semester: { id: 17, name: 'Fall 2026' }, courses: ['GCIS-123'] } },
		{ id: 7, isActive: false, expirationDate: '2025-05-01', user: { id: 5 } },
	],
	'sse.test/api/memberships': [{ userId: 3, membershipCount: 2 }],
	// Non-members' profiles: memberships null, [] or missing.
	'sse.test/api/user/1/profile': { memberships: [1, 2, 3].map((id) => ({ id, reason: `R${id}`, dateGiven: `2026-0${id}-01T00:00:00.000Z` })), officerRoles: [], isOwner: false },
	'sse.test/api/user/2/profile': { memberships: [{ id: 4, reason: 'Mentor', dateGiven: '2026-02-01' }], mentorProfile: { id: 35 } },
	'sse.test/api/user/3/profile': { memberships: [{ id: 5, reason: 'A', dateGiven: '2026-03-01' }, { id: 6, reason: 'B', dateGiven: '2026-04-01' }], isOwner: false },
	'sse.test/api/user/4/profile': { memberships: null, officerRoles: null, mentorProfile: null },
	'sse.test/api/user/5/profile': {},
	'api.github.com/users/octocat': { login: 'OctoCat', id: 583231 },
	'api.github.com/users/ghost-user-404': 404,
	'api.rit.edu/api/terms': { data: [{ code: '2275', name: 'Spring 2028' }], next_page_url: null },
	'sse.test/api/aws/image': PNG,
	// ev1: past, check-ins on (user 99 isn't on the roster); ev2: check-in not open yet; ev3: no attendance tracking.
	'sse.test/api/event': [
		{ id: 'ev1', title: ' Board  Game Night ', description: '\n\n  fun  \n', date: '2026-03-06T23:00:00.000Z', image: 'https://cdn.test/ev.png', location: 'GOL-1610', attendanceEnabled: true, grantsMembership: false },
		{ id: 'ev2', title: 'Future', description: '', date: '2099-01-01T00:00:00.000Z', location: 'Meet @ the SSE Lab', attendanceEnabled: true, grantsMembership: true },
		{ id: 'ev3', title: 'Docker Talk', description: 'x', image: 'https://cdn.test/gone.png', date: '2025-10-01T22:00:00.000Z', location: 'Altitude Trampoline Park (Meet in SSE Lab)', attendanceEnabled: false, grantsMembership: false },
	],
	'sse.test/api/event/ev1/attendance': { eventId: 'ev1', attendees: [{ id: 501, userId: 1, attendedAt: '2026-03-06T23:05:00.000Z' }, { id: 502, userId: 3, attendedAt: '2026-03-08T12:00:00.000Z' }, { id: 503, userId: 99, attendedAt: '2026-03-06T23:00:00.000Z' }] },
	'cdn.test/cat.png': PNG,
	'cdn.test/ev.png': new Uint8Array([...PNG, 9]),
};
const opts = (routes: Record<string, unknown>): SyncOptions => ({ baseUrl: 'https://sse.test', imageDir, ritApiKey: 'k', fetchFn: net(routes), lookup: async () => ['93.184.216.34'], requestGapMs: 0 });

test('roster, clean-up, lookups, departures, broken site', async () => {
	const r = await syncSse(pool, opts(sse));
	assert.deepEqual(r, { members: 5, officers: 1, officerRoles: 3, positions: 2, vacant: 1, mentors: 1, profilesFetched: 5, events: 3, attendanceFetched: 1, checkins: 2, gitHubChecked: 3, imagesSaved: 3, imagesFailed: 2 });

	const pres = await sseMemberByEmail(pool, 'pres@g.rit.edu');
	assert.equal(pres?.id, 1);
	assert.equal(pres?.isTestAccount, false);
	assert.equal(pres?.status, 'officer');
	assert.equal(pres?.isMember, true);
	assert.deepEqual(pres?.positions.map((p) => [p.title, p.isPrimary, p.isActive]), [['President', true, true], ['Tech Head', false, false], ['Winterball Head', false, false]]);
	// Past terms come from the role dates; the current one is also seen live. (Later terms of the President role join as they begin.)
	const terms = pres!.officerTerms.map((t) => [t.term, t.position.title, t.termCode, t.fromDates, !!t.lastSeenAt]);
	assert.deepEqual(terms.slice(-3), [['Fall 2026', 'President', '2261', true, termOf(new Date()).term === 'Fall 2026'], ['Spring 2026', 'Tech Head', '2255', true, false], ['Spring 2021', 'Winterball Head', '2205', true, false]]);
	assert.ok(pres!.officerTerms.some((t) => t.term === termOf(new Date()).term && t.lastSeenAt && t.position.title === 'President'));
	assert.deepEqual((await pool.sseOfficerPosition.findMany({ orderBy: { id: 'asc' } })).map((p) => [p.id, p.category, p.currentOfficerId, p.isDefunct, !!p.removedAt]), [[1, 'PRIMARY_OFFICER', 10, false, false], [3, 'COMMITTEE_HEAD', null, false, false], [31, null, null, true, true]]);
	assert.deepEqual(pres?.memberships.map((m) => m.reason), ['R3', 'R2', 'R1']);
	assert.equal(pres?.isOwner, false);
	assert.deepEqual([pres?.linkedInGiven, pres?.resolvedLinkedIn, pres?.linkedInValid], ['linkedin.com/in/Pres-1', 'Pres-1', true]);
	assert.deepEqual([pres?.resolvedGitHub, pres?.gitHubId, pres?.gitHubValid], ['OctoCat', 583231, true]);
	assert.deepEqual(pres?.degrees.map((d) => `${d.major} ${d.degree}`), ['Software Engineering BS', 'Computer Science MS']);
	assert.equal(pres?.graduationTermCode, '2275');
	assert.match(pres?.imageFile ?? '', /^[a-f0-9]{64}\.png$/);
	assert.ok(existsSync(join(imageDir, pres!.imageFile!)));

	const mentor = await sseMemberByEmail(pool, 'mentor@rit.edu');
	assert.deepEqual([mentor?.status, mentor?.linkedInValid, mentor?.resolvedLinkedIn, mentor?.gitHubValid], ['mentor', false, null, false]);
	assert.deepEqual(mentor?.mentors.map((m) => [m.id, m.isActive]), [[35, true]]);
	assert.deepEqual(mentor?.mentorApplications.map((a) => [a.id, a.semesterName, a.discordUsername, a.previousSemesters, a.status, a.pronouns]), [[37, 'Fall 2026', 'abigailjc', 2, 'pending', null]]);
	assert.equal(mentor?.isOwner, null);
	assert.equal(mentor?.description, 'hello\n\nworld');
	assert.equal((await sseMemberByEmail(pool, 'member@rit.edu'))?.termMembershipCount, 2);
	const old = await sseMemberByEmail(pool, 'oldmentor@rit.edu');
	assert.deepEqual([old?.status, old?.imageFile, old?.imageError], ['guest', null, 'HTTP 500']);
	assert.deepEqual(old?.mentors.map((m) => [m.id, m.isActive]), [[7, false]]);
	assert.equal(await pool.sseMembership.count({ where: { memberId: { in: [4, 5] } } }), 0);

	// An admin-set LinkedIn slug survives syncs.
	await pool.sseMember.update({ where: { id: 2 }, data: { linkedInSlugManual: 'taveon-cameron' } });
	// Nothing changed: no GitHub, image or profile traffic on the next sync.
	calls.length = 0;
	assert.deepEqual(await syncSse(pool, opts(sse)), { members: 5, officers: 1, officerRoles: 3, positions: 2, vacant: 1, mentors: 1, profilesFetched: 0, events: 3, attendanceFetched: 0, checkins: 0, gitHubChecked: 0, imagesSaved: 0, imagesFailed: 0 });
	assert.ok(!calls.some((c) => c.startsWith('api.github.com') || c.startsWith('cdn.test') || c.endsWith('/profile')));

	// President steps down, loses a membership, the Tech Head row vanishes, and the guest leaves the site: all kept, flagged.
	const users = sse['sse.test/api/user'];
	await syncSse(pool, opts({
		...sse,
		'sse.test/api/user': [{ ...users[0], membershipCount: 2 }, users[1], users[2], users[4]],
		'sse.test/api/officer': [{ ...sse['sse.test/api/officer'][0], is_active: false }],
		'sse.test/api/officer-positions': [{ ...sse['sse.test/api/officer-positions'][0], isFilled: false, currentOfficer: null }],
		'sse.test/api/user/1/profile': { memberships: sse['sse.test/api/user/1/profile'].memberships.slice(1) },
		'sse.test/api/mentor': [{ ...sse['sse.test/api/mentor'][0], latestMentorApplication: { id: 52, status: 'pending', semester: { id: 18, name: 'Spring 2027' } } }],
	}));
	// Reapplied: the new application joins the old one, and the vanished inactive mentor record is flagged.
	assert.deepEqual((await sseMemberByEmail(pool, 'mentor@rit.edu'))?.mentorApplications.map((a) => a.semesterName).sort(), ['Fall 2026', 'Spring 2027']);
	assert.ok((await pool.sseMentor.findUnique({ where: { id: 7 } }))?.removedAt);
	assert.deepEqual(await pool.sseMember.findUnique({ where: { id: 2 }, select: { resolvedLinkedIn: true, linkedInValid: true } }), { resolvedLinkedIn: 'taveon-cameron', linkedInValid: true });
	const was = await sseMemberByEmail(pool, 'pres@g.rit.edu');
	assert.equal(was?.status, 'member');
	assert.deepEqual(was?.positions.map((p) => [p.title, p.isActive, !!p.removedAt]), [['President', false, false], ['Tech Head', false, true], ['Winterball Head', false, true]]);
	// Term records outlive the vacancy; the vanished Tech Head role's term stays but no longer counts as derived from dates.
	assert.deepEqual(was?.officerTerms.filter((t) => !t.fromDates).map((t) => [t.term, t.position.title]), [['Spring 2026', 'Tech Head'], ['Spring 2021', 'Winterball Head']]);
	assert.deepEqual((await pool.sseOfficerPosition.findMany({ orderBy: { id: 'asc' } })).map((p) => [p.id, p.currentOfficerId, !!p.removedAt]), [[1, null, false], [3, null, true], [31, null, true]]);
	assert.deepEqual(was?.memberships.map((m) => [m.reason, !!m.removedAt]), [['R3', false], ['R2', false], ['R1', true]]);
	assert.equal(await sseMemberByEmail(pool, 'guest@rit.edu'), null);
	assert.ok((await pool.sseMember.findUnique({ where: { id: 4 } }))?.removedAt);

	// One endpoint down, or an empty roster: throw, keep the last good copy.
	await assert.rejects(syncSse(pool, opts({ ...sse, 'sse.test/api/mentor': undefined })));
	await assert.rejects(syncSse(pool, opts({ ...sse, 'sse.test/api/user': [] })));
	assert.equal(await pool.sseMember.count({ where: { removedAt: null } }), 4);
});

test('events: every field, parsed places, check-ins kept when the site drops them', async () => {
	// Runs after the roster test, so members 1-3 and the three events are mirrored.
	const ev1 = await pool.sseEvent.findUniqueOrThrow({ where: { id: 'ev1' }, include: { places: true, attendance: { orderBy: { id: 'asc' } } } });
	assert.deepEqual([ev1.title, ev1.description, ev1.locationGiven, ev1.location, ev1.attendanceEnabled, !!ev1.attendanceFetchedAt], ['Board Game Night', 'fun', 'GOL-1610', 'GOL-1610', true, true]);
	assert.deepEqual(ev1.places.map((p) => [p.place, p.room, p.role]), [['The Temporary Lab', 'GOL-1610', 'at']]);
	assert.deepEqual([ev1.category, ev1.series], ['social', 'Game Night']);
	assert.match(ev1.imageFile ?? '', /^[a-f0-9]{64}\.png$/);
	assert.ok(existsSync(join(imageDir, ev1.imageFile!)));
	assert.deepEqual((await pool.eventCategory.findUniqueOrThrow({ where: { key: 'talk' } })).runBy, 'Talks Head');
	// An admin recategorises ev3 (kept) and renames its category in the table (the code's name comes back).
	await pool.sseEvent.update({ where: { id: 'ev3' }, data: { categoryManual: 'company', seriesManual: 'Docker Inc.' } });
	await pool.eventCategory.update({ where: { key: 'talk' }, data: { name: 'Member talks' } });
	assert.deepEqual(ev1.attendance.map((a) => [a.id, a.memberId, !!a.removedAt]), [[501, 1, false], [502, 3, false]]);
	const ev3 = await pool.sseEvent.findUniqueOrThrow({ where: { id: 'ev3' }, include: { places: { orderBy: { sort: 'asc' } } } });
	assert.deepEqual(ev3.places.map((p) => [p.place, p.role]), [['Altitude Trampoline Park', 'at'], ['The Lab', 'meet']]);
	assert.equal(ev3.attendanceFetchedAt, null);

	// A week later: ev1 is rechecked, one check-in was deleted on the site; ev3 moved; ev2 was deleted.
	await pool.sseEvent.update({ where: { id: 'ev1' }, data: { attendanceFetchedAt: new Date(Date.now() - 8 * 86_400_000) } });
	const events = sse['sse.test/api/event'];
	const r = await syncSse(pool, opts({
		...sse,
		'sse.test/api/event': [events[0], { ...events[2], location: 'Zoom' }],
		'sse.test/api/event/ev1/attendance': { attendees: sse['sse.test/api/event/ev1/attendance'].attendees.slice(0, 1) },
	}));
	assert.deepEqual([r.events, r.attendanceFetched, r.checkins], [2, 1, 1]);
	assert.deepEqual((await pool.sseEventAttendance.findMany({ orderBy: { id: 'asc' } })).map((a) => [a.id, !!a.removedAt]), [[501, false], [502, true]]);
	assert.deepEqual((await pool.sseEventPlace.findMany({ where: { eventId: 'ev3' } })).map((p) => p.place), ['Online']);
	const ev3after = await pool.sseEvent.findUniqueOrThrow({ where: { id: 'ev3' } });
	assert.deepEqual([ev3after.category, ev3after.categoryManual, ev3after.seriesManual, ev3after.imageError], ['talk', 'company', 'Docker Inc.', 'HTTP 500']);
	assert.equal((await pool.eventCategory.findUniqueOrThrow({ where: { key: 'talk' } })).name, 'Talks');
	assert.ok((await pool.sseEvent.findUniqueOrThrow({ where: { id: 'ev2' } })).removedAt);
	await assert.rejects(syncSse(pool, opts({ ...sse, 'sse.test/api/event': [] })), /no events/);
});

test('driveImage', () => {
	assert.equal(driveImage('https://drive.google.com/file/d/1_FcT4r-x/view?usp=sharing'), 'https://drive.google.com/thumbnail?id=1_FcT4r-x&sz=w1600');
	assert.equal(driveImage('https://cdn.test/a.png'), 'https://cdn.test/a.png');
});

test('politeFetch spaces SSE requests and waits out 429', async () => {
	const seen: number[] = [];
	let n = 0;
	const f = politeFetch((async (u: string) => {
		seen.push(Date.now());
		if (new URL(u).host !== 'sse.test') return new Response('other');
		return ++n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : new Response('ok');
	}) as unknown as typeof fetch, 'https://sse.test', 50);
	const [a, b] = await Promise.all([f('https://sse.test/api/user'), f('https://sse.test/api/mentor')]);
	assert.deepEqual([a.status, b.status], [200, 200]);
	assert.equal(seen.length, 3); // 429, retry, second request
	assert.ok(seen[2] - seen[0] >= 95, `gaps too short: ${seen.map((t) => t - seen[0])}`);
	assert.equal(await (await f('https://cdn.test/x')).text(), 'other');
});

test('saveImage refuses private addresses and non-images', async () => {
	const o = { baseUrl: 'https://sse.test', dir: imageDir, fetchFn: net({ 'cdn.test/x.png': PNG, 'cdn.test/page': { not: 'an image' } }) };
	await assert.rejects(saveImage('http://127.0.0.1/x.png', o), /private/);
	await assert.rejects(saveImage('https://cdn.test/x.png', { ...o, lookup: async () => ['10.0.0.5'] }), /private/);
	await assert.rejects(saveImage('https://cdn.test/x.png', { ...o, lookup: async () => ['::ffff:169.254.169.254'] }), /private/);
	await assert.rejects(saveImage('file:///etc/passwd', o), /scheme/);
	await assert.rejects(saveImage('https://cdn.test/page', { ...o, lookup: async () => ['93.184.216.34'] }), /not a supported image/);
});

test('ritTermCode: API first, semester pattern otherwise, null before semesters', () => {
	const api = new Map([['Spring 2026', '2255']]);
	assert.equal(ritTermCode(api, 'SPRING', 2026), '2255');
	assert.equal(ritTermCode(api, 'FALL', 2029), '2291');
	assert.equal(ritTermCode(api, 'SUMMER', 2030), '2298');
	assert.equal(ritTermCode(api, 'SPRING', 2014), '2135');
	assert.equal(ritTermCode(api, 'SPRING', 2006), null);
	assert.equal(ritTermCode(api, null, 2026), null);
});

test('termOf: Spring Jan-May, Summer Jun-Jul, Fall Aug-Dec', () => {
	assert.deepEqual(termOf(new Date(2026, 4, 31)), { term: 'Spring 2026', season: 'SPRING', year: 2026, start: new Date(2026, 0, 1), end: new Date(2026, 5, 1) });
	assert.equal(termOf(new Date(2026, 5, 1)).term, 'Summer 2026');
	assert.equal(termOf(new Date(2026, 7, 1)).term, 'Fall 2026');
	assert.equal(termOf(new Date(2027, 0, 5)).term, 'Spring 2027');
});

test('termsServed: a third of the term counts, minutes-long fixes and future terms do not', () => {
	const now = new Date(2026, 9, 26);
	const names = (a: Date, b: Date) => termsServed(a, b, now).map((t) => t.term);
	assert.deepEqual(names(new Date(2026, 7, 1), new Date(2027, 4, 31)), ['Fall 2026']); // Spring 2027 hasn't begun
	assert.deepEqual(names(new Date(2026, 4, 1), new Date(2027, 4, 14)), ['Summer 2026', 'Fall 2026']); // May alone is < 1/3 of Spring
	assert.deepEqual(names(new Date(2026, 4, 1, 23, 3), new Date(2026, 4, 1, 23, 32)), []);
	assert.deepEqual(names(new Date(2025, 10, 1), new Date(2026, 1, 15)), ['Fall 2025']); // 40% of Fall counts, 30% of Spring doesn't
	// A mid-term handover counts for both holders.
	assert.deepEqual([names(new Date(2026, 0, 10), new Date(2026, 2, 20)), names(new Date(2026, 2, 20), new Date(2026, 4, 31))], [['Spring 2026'], ['Spring 2026']]);
});
