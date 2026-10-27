import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { testPrisma } from '../test-db.ts';
import { account, checkLedger, postTransaction } from '../ledger/ledger.ts';
import { grant } from '../markets/markets.ts';
import { checkinCounts, EARN_SOURCES, ruleFor, settleEarnings } from './earn.ts';

let db: PrismaClient;
let drop: () => Promise<void>;
before(async () => ({ prisma: db, drop } = await testPrisma()));
after(() => drop());

const T = (s: string) => new Date(s);
const bal = async (userId: number, c: number) => (await db.account.findUnique({ where: { ownerType_ownerId_currencyId: { ownerType: 'user', ownerId: userId, currencyId: c } } }))?.balance ?? 0;
const awards = (source: string) => db.earnAward.findMany({ where: { source }, orderBy: { id: 'asc' } }).then((r) => r.map((a) => [a.sourceId, a.amount, a.target, a.reason]));

test('checkinCounts: 15 minutes early to 6 hours late', () => {
	const ev = T('2026-03-06T23:00:00Z');
	assert.equal(checkinCounts(T('2026-03-06T22:45:00Z'), ev), true);
	assert.equal(checkinCounts(T('2026-03-06T22:44:59Z'), ev), false);
	assert.equal(checkinCounts(T('2026-03-07T05:00:00Z'), ev), true);
	assert.equal(checkinCounts(T('2026-03-08T12:00:00Z'), ev), false);
});

test('ruleFor: newest set wins, event weight beats the default, future rules wait', () => {
	const r = (id: number, extra: object) => ({ id, kind: 'sse_checkin', sseEventId: null, siteEventId: null, category: null, amount: id, effectiveFrom: T('2026-01-01'), createdAt: T('2026-01-01'), ...extra });
	const rules = [r(1, {}), r(2, { createdAt: T('2026-05-01') }), r(3, { sseEventId: 'ev1' }), r(4, { effectiveFrom: T('2099-01-01'), createdAt: T('2026-06-01') })];
	assert.equal(ruleFor(rules, 'sse_checkin', T('2026-03-01'))?.id, 2);
	assert.equal(ruleFor(rules, 'sse_checkin', T('2026-03-01'), { sse: 'ev1' })?.id, 3);
	const withTalks = [...rules, r(5, { category: 'talk' })];
	assert.equal(ruleFor(withTalks, 'sse_checkin', T('2026-03-01'), { sse: 'ev9', category: 'talk' })?.id, 5); // category beats the default
	assert.equal(ruleFor(withTalks, 'sse_checkin', T('2026-03-01'), { sse: 'ev1', category: 'talk' })?.id, 3); // the event beats its category
	assert.equal(ruleFor(withTalks, 'sse_checkin', T('2026-03-01'), { category: 'social' })?.id, 2);
	assert.equal(ruleFor(rules, 'sse_checkin', T('2025-03-01')), null);
	assert.equal(ruleFor(rules, 'site_event', T('2026-03-01')), null);
});

test('settleEarnings pays, re-prices, takes back, and audits every change', async () => {
	const coin = await db.currency.create({ data: { code: 'SITE', name: 'Site dabloons', kind: 'internal' } });
	const a = await db.user.create({ data: { email: 'abc1234@rit.edu', displayName: 'A' } });
	const b = await db.user.create({ data: { email: 'b@example.test', displayName: 'B' } });
	const now = new Date();
	const member = (id: number, email: string) => db.sseMember.create({ data: { id, email, name: `M${id}`, membershipFetchedAt: now, syncedAt: now } });
	await member(1, 'abc1234@g.rit.edu'); // A, by the @g.rit.edu form
	await member(2, 'nobody@g.rit.edu'); // not signed up here: earns nothing yet
	const ev = (id: string, date: string) => db.sseEvent.create({ data: { id, title: id, date: T(date), attendanceEnabled: true, grantsMembership: false, syncedAt: now } });
	await ev('ev1', '2026-03-06T23:00:00Z');
	await ev('ev2', '2026-03-13T23:00:00Z');
	await db.sseMembership.create({ data: { id: 11, memberId: 1, reason: 'Officer', dateGiven: T('2026-02-01') } });
	await db.sseMembership.create({ data: { id: 12, memberId: 2, reason: 'Officer', dateGiven: T('2026-02-01') } });
	await db.sseEventAttendance.create({ data: { id: 501, eventId: 'ev1', memberId: 1, attendedAt: T('2026-03-06T23:05:00Z') } });
	await db.sseEventAttendance.create({ data: { id: 502, eventId: 'ev2', memberId: 1, attendedAt: T('2026-03-20T12:00:00Z') } }); // a week late
	await db.manualCheckin.create({ data: { eventId: 'ev2', memberId: 1, source: 'sign-in sheet' } }); // was there; fills the gap
	await db.manualCheckin.create({ data: { eventId: 'ev1', memberId: 1, source: 'sign-in sheet' } }); // SSE check-in already pays
	const party = await db.siteEvent.create({ data: { title: 'Launch party', date: T('2026-10-01') } });
	const bAtParty = await db.siteEventCheckin.create({ data: { eventId: party.id, userId: b.id } });

	// No rates yet: nothing is worth anything.
	assert.deepEqual(await settleEarnings(db, coin.id), { posted: 0, net: 0 });

	const from = T('2000-01-01');
	await db.earnRule.createMany({ data: [
		{ kind: 'sse_membership', amount: 250, effectiveFrom: from },
		{ kind: 'sse_checkin', amount: 50, effectiveFrom: from },
		{ kind: 'sse_checkin', sseEventId: 'ev1', amount: 100, effectiveFrom: from, note: 'big event' },
		{ kind: 'site_event', amount: 30, effectiveFrom: from },
	] });
	assert.deepEqual(await settleEarnings(db, coin.id), { posted: 4, net: 430 });
	assert.equal(await bal(a.id, coin.id), 400); // 250 membership + 100 ev1 + 50 ev2 (manual)
	assert.equal(await bal(b.id, coin.id), 30);
	assert.deepEqual(await awards('sse_checkin'), [['501', 100, 100, 'earned']]);
	assert.equal((await db.earnAward.findFirstOrThrow({ where: { source: 'manual_checkin' } })).amount, 50);
	// Each source is its own sub-ledger.
	const earned = await db.account.findMany({ where: { ownerType: 'earn', currencyId: coin.id }, orderBy: { ownerId: 'asc' } });
	assert.deepEqual(earned.map((x) => [x.ownerId, x.balance]), [[EARN_SOURCES.sse_membership, -250], [EARN_SOURCES.sse_checkin, -100], [EARN_SOURCES.manual_checkin, -50], [EARN_SOURCES.site_event, -30]]);

	// Idempotent.
	assert.deepEqual(await settleEarnings(db, coin.id), { posted: 0, net: 0 });

	// Memberships are now worth 300, back-dated: the paid one is topped up. A future-dated change touches nothing yet.
	await db.earnRule.create({ data: { kind: 'sse_membership', amount: 300, effectiveFrom: from } });
	await db.earnRule.create({ data: { kind: 'site_event', amount: 1000, effectiveFrom: T('2099-01-01') } });
	assert.deepEqual(await settleEarnings(db, coin.id), { posted: 1, net: 50 });
	assert.deepEqual(await awards('sse_membership'), [['11', 250, 250, 'earned'], ['11', 50, 300, 'repriced']]);

	// The SSE site removes the membership: all 300 comes back.
	await db.sseMembership.update({ where: { id: 11 }, data: { removedAt: now } });
	await settleEarnings(db, coin.id);
	assert.equal(await bal(a.id, coin.id), 150);
	assert.deepEqual((await awards('sse_membership')).at(-1), ['11', -300, 0, 'removed']);

	// B spent 20 of their 30, then their party check-in is withdrawn: only 10 can come back now, the other 20 once they have dabloons.
	await postTransaction(db, { kind: 'adjustment', currencyId: coin.id, idempotencyKey: 'spend', entries: [{ accountId: await account(db, 'user', b.id, coin.id), amount: -20 }, { accountId: await account(db, 'house', 0, coin.id), amount: 20 }] });
	await db.siteEventCheckin.update({ where: { id: bAtParty.id }, data: { removedAt: now } });
	await settleEarnings(db, coin.id);
	assert.deepEqual((await awards('site_event')).at(-1), [String(bAtParty.id), -10, 0, 'removed (capped)']);
	assert.equal(await bal(b.id, coin.id), 0);
	await grant(db, b.id, coin.id, 50, 'gift');
	await settleEarnings(db, coin.id);
	assert.equal(await bal(b.id, coin.id), 30);
	assert.deepEqual(await settleEarnings(db, coin.id), { posted: 0, net: 0 });

	assert.deepEqual(await checkLedger(db), []);
	// Every award row is backed by exactly one ledger transaction.
	assert.equal(await db.ledgerTransaction.count({ where: { kind: 'earn' } }), await db.earnAward.count());
});
