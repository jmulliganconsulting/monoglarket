// Dev data: one internal currency, a few members, three open markets. Safe to re-run.
import { createPrisma } from '../src/db/db.ts';
import { buy, grant, openMarket } from '../src/markets/markets.ts';

const prisma = createPrisma();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

const coin = await prisma.currency.upsert({
	where: { code: 'DBLN' },
	create: { code: 'DBLN', name: 'Dabloons', kind: 'internal', signupGrant: 3000 },
	update: { signupGrant: 3000 },
});
// Starting market categories (vault "Categories"). Admins add more on /admin.
const CATEGORIES = ['Sports', 'Academics', 'Campus life', 'Weather', 'Club', 'Entertainment', 'World'];
for (const [sort, name] of CATEGORIES.entries())
	await prisma.category.upsert({ where: { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }, create: { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sort: sort + 1 }, update: {} });

// Starting rates for sitecurrency earning (src/earn/earn.ts); change them by adding rows, not editing these.
if ((await prisma.earnRule.count()) === 0)
	await prisma.earnRule.createMany({ data: [
		{ kind: 'sse_membership', amount: 1000, effectiveFrom: new Date(0), note: 'seed' },
		{ kind: 'sse_checkin', amount: 500, effectiveFrom: new Date(0), note: 'seed' },
		{ kind: 'site_event', amount: 500, effectiveFrom: new Date(0), note: 'seed' },
	] });
const users = [];
for (const name of ['Ana', 'Ben', 'Cy']) {
	const email = `${name.toLowerCase()}@example.test`;
	const u = await prisma.user.upsert({ where: { email }, create: { email, displayName: name }, update: {} });
	if (!(await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: `grant:${u.id}` } }))) await grant(prisma, u.id, coin.id, 1000, `grant:${u.id}`);
	users.push(u);
}

if ((await prisma.market.count()) === 0) {
	const regionals = await openMarket(prisma, { question: 'Will the robotics team win regionals?', criteria: 'Official competition results page', currencyId: coin.id, outcomes: ['Yes', 'No'], subsidy: 100, closeAt: inDays(14), moderatorId: users[0].id });
	await openMarket(prisma, { question: 'How many people come to the bake sale?', criteria: 'Head count by the organiser', currencyId: coin.id, outcomes: ['Under 30', '30–60', 'Over 60'], subsidy: 110, closeAt: inDays(7), moderatorId: users[0].id });
	await openMarket(prisma, { question: 'Will it snow on the first day of winter break?', criteria: 'National weather service daily report', currencyId: coin.id, outcomes: ['Yes', 'No'], subsidy: 70, closeAt: inDays(30), moderatorId: users[0].id });
	await buy(prisma, { userId: users[0].id, marketId: regionals.marketId, outcomeId: regionals.outcomeIds[0], spend: 40, minShares: 0, idempotencyKey: 'seed:buy:1' });
}

console.log('seeded');
await prisma.$disconnect();
