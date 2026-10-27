// One-off: move the live site to 3000 starting dabloons, 1000 per SSE membership, 500 per event attendance. Safe to re-run.
//   node scripts/backport-rates.ts
// 1. Sets the DBLN signup grant to 3000 (new members).
// 2. Adds EarnRule rows for the new rates (newest row wins), then reprices every earning item (settleEarnings).
// 3. Tops up every member who was paid a signup grant to at least 3000. Members still to finish onboarding are skipped:
//    they get 3000 on their last onboarding screen.
import { createPrisma } from '../src/db/db.ts';
import { settleEarnings } from '../src/earn/earn.ts';
import { grant } from '../src/markets/markets.ts';

const FLOOR = 3000;
const RATES = [
	{ kind: 'sse_membership', amount: 1000 },
	{ kind: 'sse_checkin', amount: 500 },
	{ kind: 'site_event', amount: 500 },
];

const prisma = createPrisma();
try {
	const coin = await prisma.currency.update({ where: { code: 'DBLN' }, data: { signupGrant: FLOOR } });

	for (const { kind, amount } of RATES) {
		const live = await prisma.earnRule.findFirst({
			where: { kind, sseEventId: null, siteEventId: null, category: null },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		});
		if (live?.amount !== amount) await prisma.earnRule.create({ data: { kind, amount, effectiveFrom: new Date(0), note: 'backport 3000 rates' } });
	}
	console.log('earnings', await settleEarnings(prisma, coin.id));

	let topped = 0;
	for (const { id } of await prisma.user.findMany({ select: { id: true } })) {
		const signedUp = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: `signup:${id}:${coin.id}` }, select: { id: true } });
		if (!signedUp) continue;
		const acct = await prisma.account.findUnique({ where: { ownerType_ownerId_currencyId: { ownerType: 'user', ownerId: id, currencyId: coin.id } }, select: { balance: true } });
		const balance = acct?.balance ?? 0;
		if (balance >= FLOOR) continue;
		await grant(prisma, id, coin.id, FLOOR - balance, `topup:${FLOOR}:${id}:${coin.id}`);
		topped++;
	}
	console.log(`topped up ${topped} members to ${FLOOR}`);
} finally {
	await prisma.$disconnect();
}
