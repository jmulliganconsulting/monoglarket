// Creates the club's starting prediction markets, with options and colours set automatically.
// Usage: MODERATOR_EMAIL=you@example.com node scripts/seed-predictions.ts
// Safe to re-run: a market or question whose text already exists is skipped.
import { createPrisma } from '../src/db/db.ts';
import { createMarket, createQuestionGroup, approveQuestionGroup, openMarket } from '../src/markets/markets.ts';
import { setAppearance } from '../src/visuals/appearance.ts';
import { board } from '../src/leaderboard/boards.ts';

const prisma = createPrisma();

const moderator = await prisma.user.findUnique({ where: { email: process.env.MODERATOR_EMAIL ?? '' } });
if (!moderator) throw new Error('set MODERATOR_EMAIL to the email of an existing moderator');
const currency = await prisma.currency.findUnique({ where: { code: 'DBLN' } });
if (!currency) throw new Error('currency DBLN not found; run the app seed first');

// Creates the category if it is missing, the same way prisma/seed.ts does; admins can rename or add more on /admin.
const CATEGORY_NAMES: Record<string, string> = { 'campus-life': 'Campus life', club: 'Club', weather: 'Weather' };
const categoryId = async (key: string) => (await prisma.category.upsert({ where: { key }, create: { key, name: CATEGORY_NAMES[key] }, update: {} })).id;

// Colours: Yes is green and No is red on every yes/no market. Ordered options (a count or a length) use a blue ramp, light to dark.
const YES = '#2e7d32';
const NO = '#c62828';
const RAMP = ['#90caf9', '#42a5f5', '#1e88e5', '#1565c0', '#0d47a1'];
const rampColour = (i: number, n: number) => RAMP[n <= 1 ? RAMP.length - 1 : Math.round((i * (RAMP.length - 1)) / (n - 1))];
const yesNoColours = { colorPrimary: YES, colorSecondary: NO };
const yesNoOutcomes = (ids: number[]) => ids.map((id, i) => ({ id, color: i === 0 ? YES : NO }));

const endOf = (iso: string) => new Date(`${iso}T23:59:00Z`);

// Single yes/no markets. Each is opened right away (approved by the moderator).
const yesNo = [
	{ question: 'Will eduroam or the campus Wi-Fi go down before 2027?', criteria: 'Yes if RIT IT reports an eduroam or campus Wi-Fi outage on its status page between now and 31 Dec 2026.', closeAt: endOf('2026-12-31'), category: 'campus-life' },
	{ question: 'Will the SSE website have any downtime before 2027?', criteria: 'Yes if the SSE website is down for any period before 1 Jan 2027, per the uptime monitor.', closeAt: endOf('2026-12-31'), category: 'club' },
	{ question: 'Will the SSE printer receive ink before Reading Day (12/8)?', criteria: 'Yes if new ink is logged as delivered to the SSE printer on or before 8 Dec 2026.', closeAt: endOf('2026-12-07'), category: 'club' },
	{ question: 'Will RIT get snow before December 1?', criteria: 'Yes if the National Weather Service records measurable snowfall in Rochester before 1 Dec 2026.', closeAt: new Date('2026-12-01T05:00:00Z'), category: 'weather' },
];

for (const m of yesNo) {
	if (await prisma.market.findFirst({ where: { question: m.question } })) continue;
	const { marketId, outcomeIds } = await openMarket(prisma, {
		question: m.question,
		criteria: m.criteria,
		currencyId: currency.id,
		outcomes: ['Yes', 'No'],
		subsidy: 100,
		closeAt: m.closeAt,
		categoryId: await categoryId(m.category),
		...yesNoColours,
		moderatorId: moderator.id,
	});
	await setAppearance(prisma, { marketId, moderatorId: moderator.id, colorPrimary: YES, colorSecondary: NO, outcomes: yesNoOutcomes(outcomeIds) });
}

// Several-winner questions: one yes/no market per option, each resolved on its own (ADR-020).
// "Next event" and "next meeting" have no fixed date, so these stay open until a moderator closes them.
const several = [
	{ question: 'How many people will check into the next event?', criteria: 'The official check-in count for the next SSE event in the app.', options: ['At least 5', 'At least 10', 'At least 15', 'At least 20'], category: 'club' },
	{ question: 'How long will the next general meeting be?', criteria: 'Start and end times for the next general meeting, as recorded by the officer running it.', options: ['Under 5 minutes', 'Under 10 minutes', 'Under 30 minutes', 'Under 60 minutes'], category: 'club' },
];

for (const q of several) {
	if (await prisma.questionGroup.findFirst({ where: { question: q.question } })) continue;
	const groupId = await createQuestionGroup(prisma, {
		question: q.question,
		criteria: q.criteria,
		currencyId: currency.id,
		options: q.options,
		subsidy: 70,
		closeAt: null,
		categoryId: await categoryId(q.category),
		creatorId: moderator.id,
	});
	await approveQuestionGroup(prisma, { groupId, moderatorId: moderator.id });
	const markets = await prisma.market.findMany({ where: { questionGroupId: groupId }, orderBy: { id: 'asc' }, include: { outcomes: { orderBy: { sort: 'asc' } } } });
	for (const [i, m] of markets.entries()) {
		const colour = rampColour(i, markets.length);
		await setAppearance(prisma, { marketId: m.id, moderatorId: moderator.id, colorPrimary: colour, colorSecondary: '#757575', outcomes: yesNoOutcomes(m.outcomes.map((o) => o.id)) });
	}
}

// Who has the most currency at term end: the "Most currency" leaderboard board. A market holds at most 10 options, so the
// options are the top 10 members right now. Members who rise into the top 10 later are not added.
const TERM_END = endOf('2026-12-18');
const POINTS_QUESTION = 'Who will have the most membership points at the end of the term?';
if (!(await prisma.market.findFirst({ where: { question: POINTS_QUESTION } }))) {
	const top = (await board(prisma, currency.id, 'worth')).rows.slice(0, 10);
	// Two members can share a name; a repeated name gets the username (or id) after it so each option is distinct.
	const labels = top.map((r) => (top.filter((x) => x.name === r.name).length > 1 ? `${r.name} (${r.username ?? `#${r.id}`})` : r.name));
	const { marketId, outcomeIds } = await openMarket(prisma, {
		question: POINTS_QUESTION,
		criteria: 'The member with the most currency on the Most currency leaderboard when the term ends (18 Dec 2026).',
		currencyId: currency.id,
		outcomes: labels,
		subsidy: 100,
		closeAt: TERM_END,
		categoryId: await categoryId('club'),
		colorPrimary: rampColour(top.length - 1, top.length),
		colorSecondary: '#757575',
		moderatorId: moderator.id,
	});
	await setAppearance(prisma, { marketId, moderatorId: moderator.id, colorPrimary: rampColour(top.length - 1, top.length), colorSecondary: '#757575', outcomes: outcomeIds.map((id, i) => ({ id, color: rampColour(i, top.length) })) });
}

console.log('predictions seeded');
await prisma.$disconnect();
