// Turns what members do into sitecurrency: SSE memberships, SSE event check-ins, our own records of SSE attendance (ManualCheckin),
// and check-ins at this site's own events. Design: vault note "Earning sitecurrency".
// settleEarnings is a reconciler: for every item it works out what the item should have paid under today's rules (EarnRule), compares
// that with what its EarnAward rows have paid, and posts the difference. So it is safe to run any time, a new membership pays on the
// next run, a removed one is taken back, and a changed rate re-prices whatever it covers. Each posting is one EarnAward row + one
// ledger transaction from that source's own earn account, so every source is a separate sub-ledger.
import { withTx, type PrismaClient } from '../db/db.ts';
import { account, balance, postTransaction } from '../ledger/ledger.ts';
import { ritEmail } from '../sse/normalize.ts';

/** Each source pays from its own account: ('earn', id, currency). Never renumber. */
export const EARN_SOURCES = { sse_membership: 1, sse_checkin: 2, manual_checkin: 3, site_event: 4 } as const;
export type EarnSource = keyof typeof EARN_SOURCES;
/** EarnRule.kind. Manual check-ins are priced like the SSE check-ins they stand in for. */
export type EarnKind = 'sse_membership' | 'sse_checkin' | 'site_event';

/** The SSE site never closes check-in, so only check-ins near the event count: from 15 minutes before its start to 6 hours after. */
export const CHECKIN_WINDOW = { beforeMs: 15 * 60_000, afterMs: 6 * 3_600_000 };
export const checkinCounts = (attendedAt: Date, eventDate: Date) =>
	+attendedAt >= +eventDate - CHECKIN_WINDOW.beforeMs && +attendedAt <= +eventDate + CHECKIN_WINDOW.afterMs;

type Rule = { id: number; kind: string; sseEventId: string | null; siteEventId: number | null; category: string | null; amount: number; effectiveFrom: Date; createdAt: Date };

/** Newest-set rule in effect on `at`: one for this exact event, else for its category, else the kind's default. null = no rate set, earns nothing. */
export function ruleFor(rules: Rule[], kind: EarnKind, at: Date, event: { sse?: string; site?: number; category?: string } = {}): Rule | null {
	const live = rules.filter((r) => r.kind === kind && r.effectiveFrom <= at).sort((a, b) => +b.createdAt - +a.createdAt || b.id - a.id);
	return (
		live.find((r) => (event.sse && r.sseEventId === event.sse) || (event.site && r.siteEventId === event.site)) ??
		live.find((r) => event.category && !r.sseEventId && !r.siteEventId && r.category === event.category) ??
		live.find((r) => !r.sseEventId && !r.siteEventId && !r.category) ??
		null
	);
}

type Item = { source: EarnSource; sourceId: string; userId: number; target: number; ruleId: number | null; why: 'earned' | 'removed' | 'not_counted'; memo: string };

async function items(prisma: PrismaClient): Promise<Item[]> {
	const rules = await prisma.earnRule.findMany();
	// SSE rows join our users on email; the SSE site has x@g.rit.edu where we may have x@rit.edu.
	const userByEmail = new Map((await prisma.user.findMany({ where: { email: { not: null } }, select: { id: true, email: true } })).map((u) => [ritEmail(u.email!.toLowerCase()), u.id]));
	const userByMember = new Map<number, number>();
	for (const m of await prisma.sseMember.findMany({ select: { id: true, email: true } })) {
		const u = userByEmail.get(ritEmail(m.email.toLowerCase()));
		if (u) userByMember.set(m.id, u);
	}
	const out: Item[] = [];
	const push = (source: EarnSource, sourceId: number, userId: number | undefined, rule: Rule | null, why: Item['why'], memo: string) => {
		if (userId) out.push({ source, sourceId: String(sourceId), userId, target: why === 'earned' ? (rule?.amount ?? 0) : 0, ruleId: rule?.id ?? null, why, memo });
	};

	for (const m of await prisma.sseMembership.findMany())
		push('sse_membership', m.id, userByMember.get(m.memberId), ruleFor(rules, 'sse_membership', m.dateGiven), m.removedAt ? 'removed' : 'earned', `SSE membership: ${m.reason}`);

	const counted = new Set<string>(); // eventId:memberId with an SSE check-in that pays
	const eventSelect = { select: { date: true, title: true, removedAt: true, category: true, categoryManual: true } };
	const kindOf = (e: { category: string; categoryManual: string | null }) => e.categoryManual ?? e.category;
	for (const a of await prisma.sseEventAttendance.findMany({ include: { event: eventSelect } })) {
		const ok = checkinCounts(a.attendedAt, a.event.date);
		const why = a.removedAt || a.event.removedAt ? 'removed' : ok ? 'earned' : 'not_counted';
		if (why === 'earned') counted.add(`${a.eventId}:${a.memberId}`);
		push('sse_checkin', a.id, userByMember.get(a.memberId), ruleFor(rules, 'sse_checkin', a.event.date, { sse: a.eventId, category: kindOf(a.event) }), why, `Checked in: ${a.event.title}`);
	}
	// Our own attendance records only fill gaps: if the SSE site's check-in already pays for that event, this one doesn't.
	for (const c of await prisma.manualCheckin.findMany({ include: { event: eventSelect } })) {
		const why = c.removedAt || c.event.removedAt ? 'removed' : counted.has(`${c.eventId}:${c.memberId}`) ? 'not_counted' : 'earned';
		push('manual_checkin', c.id, userByMember.get(c.memberId), ruleFor(rules, 'sse_checkin', c.event.date, { sse: c.eventId, category: kindOf(c.event) }), why, `Attended (${c.source}): ${c.event.title}`);
	}
	for (const c of await prisma.siteEventCheckin.findMany({ include: { event: { select: { date: true, title: true, cancelledAt: true } } } }))
		push('site_event', c.id, c.userId, ruleFor(rules, 'site_event', c.event.date, { site: c.eventId }), c.removedAt || c.event.cancelledAt ? 'removed' : 'earned', `Site event: ${c.event.title}`);
	return out;
}

/**
 * Pay every item the difference between what it should have paid and what it has. Take-backs are capped at the member's balance
 * (wallets never go negative); the rest is taken on a later run once they have dabloons again.
 */
export async function settleEarnings(prisma: PrismaClient, currencyId: number) {
	const paid = new Map(
		(await prisma.earnAward.groupBy({ by: ['source', 'sourceId'], where: { currencyId }, _sum: { amount: true }, _max: { seq: true } })).map((r) => [
			`${r.source}:${r.sourceId}`,
			{ sum: r._sum.amount ?? 0, seq: r._max.seq ?? 0 },
		]),
	);
	let posted = 0;
	let net = 0;
	for (const it of await items(prisma)) {
		const before = paid.get(`${it.source}:${it.sourceId}`) ?? { sum: 0, seq: 0 };
		const delta = it.target - before.sum;
		if (delta === 0) continue;
		const amount = await withTx(prisma, async (db) => {
			const user = await account(db, 'user', it.userId, currencyId);
			const amount = delta < 0 ? Math.max(delta, -(await balance(db, user))) : delta;
			if (amount === 0) return 0;
			const seq = before.seq + 1;
			const why = it.why === 'earned' && before.sum !== 0 ? 'repriced' : it.why;
			const transactionId = await postTransaction(db, {
				kind: 'earn',
				currencyId,
				idempotencyKey: `earn:${currencyId}:${it.source}:${it.sourceId}:${seq}`,
				memo: it.memo,
				entries: [
					{ accountId: await account(db, 'earn', EARN_SOURCES[it.source], currencyId), amount: -amount },
					{ accountId: user, amount },
				],
			});
			await db.earnAward.create({
				data: { source: it.source, sourceId: it.sourceId, seq, userId: it.userId, currencyId, amount, target: it.target, ruleId: it.ruleId, reason: why + (amount !== delta ? ' (capped)' : ''), transactionId },
			});
			return amount;
		});
		if (amount) (posted++, (net += amount));
	}
	return { posted, net };
}
