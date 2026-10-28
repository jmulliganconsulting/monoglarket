// Market simulation for a local dev site. Bots sign in and trade through the real form actions; an admin creates and approves markets, and a bot resolver proposes the result that the admin accepts.
// Usage: node scripts/market-sim.ts [--base=http://localhost:5173] [--bots=8] [--markets=3] [--minutes=3]
import { randomUUID } from 'node:crypto';
import { createPrisma } from '../src/db/db.ts';
import { requestLogin, verifyCode } from '../src/auth/auth.ts';
import { checkLedger } from '../src/ledger/ledger.ts';
import { DEFAULT_SPEND_CAP, grant, grantResolver } from '../src/markets/markets.ts';
import { floorCoins, proceedsForSell } from '../src/engine/lmsr.ts';
import { netOfFee } from '../src/engine/fees.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const BASE = args.base ?? 'http://localhost:5173';
const BOTS = Number(args.bots ?? 8);
const MARKETS = Number(args.markets ?? 3);
const MINUTES = Number(args.minutes ?? 3);
// Refuse anything but this machine, so bot accounts can never reach a real site.
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error(`refusing to run against ${BASE}`);

const prisma = createPrisma();
const allow = { domains: ['example.test'], emails: [] as string[] }; // matches .env ALLOWED_EMAIL_DOMAINS
const tag = Date.now().toString(36);
const stats: Record<string, { ok: number; failed: number; errors: string[] }> = {};
const tally = (name: string, ok: boolean, message = '') => {
	const s = (stats[name] ??= { ok: 0, failed: 0, errors: [] });
	if (ok) s.ok++;
	else {
		s.failed++;
		if (s.errors.length < 5) s.errors.push(message);
	}
};
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real form action call, the way SvelteKit's enhanced forms send it. Returns the JSON result.
async function act(path: string, session: string, fields: Record<string, string | number>) {
	const res = await fetch(BASE + path, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, 'x-sveltekit-action': 'true', cookie: `session=${session}` },
		body: new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])),
	});
	// Not JSON means the hooks redirected us (for example to /login because the session was not recognised).
	const text = await res.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		body = { type: 'unreadable', status: res.status, location: res.headers.get('location'), text: text.replace(/<script[\s\S]*?<\/script>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) };
	}
	return body as { type: string; status?: number; location?: string | null; data?: Record<string, unknown> };
}

async function signIn(name: string) {
	const email = `${name}-${tag}@example.test`;
	const { code } = await requestLogin(prisma, email, allow);
	const { session, user } = await verifyCode(prisma, email, code);
	// Skip the onboarding screens: the hooks send anyone not onboarded there before any trade or market form.
	await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date(), onboardingStep: 6, termsAcceptedAt: new Date(), displayName: name } });
	return { session, id: user.id, name };
}

const currency = await prisma.currency.findFirstOrThrow({ where: { kind: 'internal', active: true } });
const admin = await signIn('sim-admin');
await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } });
const bots = await Promise.all(Array.from({ length: BOTS }, (_, i) => signIn(`sim-bot${String(i + 1).padStart(2, '0')}`)));
// Roles so the leaderboard shows every name colour. Applied by name, so bots from earlier runs get them too.
// Bots match their SSE row by email, as real members do; the row's id is the negated user id so it can't hit a real SSE id.
type Persona = { studentStatus: string; seniority?: string; primary?: boolean; sse?: { status: string; isMentor?: boolean } };
const PERSONAS: Persona[] = [
	{ studentStatus: 'current', seniority: 'fourth', primary: true, sse: { status: 'officer' } }, // president
	{ studentStatus: 'faculty', primary: true, sse: { status: 'se_staff' } }, // department chair
	{ studentStatus: 'current', seniority: 'third', sse: { status: 'officer' } },
	{ studentStatus: 'current', seniority: 'second', sse: { status: 'member', isMentor: true } },
	{ studentStatus: 'alum', sse: { status: 'member' } },
	{ studentStatus: 'faculty' },
	{ studentStatus: 'current', seniority: 'phd' },
	{ studentStatus: 'faculty', sse: { status: 'se_staff' } },
	{ studentStatus: 'faculty', sse: { status: 'member', isMentor: true } },
	{ studentStatus: 'current', seniority: 'masters', sse: { status: 'member' } },
	{ studentStatus: 'current', seniority: 'fifth' },
	{ studentStatus: 'current', seniority: 'first', sse: { status: 'member' } },
	{ studentStatus: 'current', seniority: 'bs_ms' },
	{ studentStatus: 'current', seniority: 'incoming' },
];
for (const [i, bot] of bots.entries()) {
	const p = PERSONAS[i % PERSONAS.length];
	for (const u of await prisma.user.findMany({ where: { displayName: bot.name }, select: { id: true, email: true } })) {
		await prisma.user.update({ where: { id: u.id }, data: { studentStatus: p.studentStatus, seniority: p.seniority ?? null, primaryOfficerSince: p.primary ? new Date() : null } });
		const sse = p.sse && { email: u.email!, name: bot.name, isTestAccount: true, status: p.sse.status, isMentor: !!p.sse.isMentor, isMember: true, membershipCount: 1, membershipFetchedAt: new Date(), syncedAt: new Date(), removedAt: null };
		if (sse) await prisma.sseMember.upsert({ where: { id: -u.id }, create: { id: -u.id, ...sse }, update: sse });
		else await prisma.sseMember.deleteMany({ where: { id: -u.id } });
	}
}

// A resolver with a position can't resolve that market (the app's rule), so the resolver never trades.
const resolver = await signIn('sim-resolver');
for (const b of [...bots, resolver]) await grant(prisma, b.id, currency.id, 1000, `sim-grant:${b.id}:${tag}`);
console.log(`Signed in admin and ${BOTS} bots on ${BASE}; each bot has 1000 ${currency.code}.`);

// The admin proposes markets through the real form, then approves them.
const closeAt = new Date(Date.now() + MINUTES * 60_000).toISOString();
const questions = Array.from({ length: MARKETS }, (_, i) => `Sim ${tag} #${i + 1}: will the bot population pick yes?`);
for (const question of questions) {
	const r = await act('/markets/new', admin.session, { question, criteria: 'Simulation: the resolver decides', outcomes: 'Yes\nNo\nMaybe', subsidy: 100, closeAt, kind: 'one', colorPrimary: '#2563eb', colorSecondary: '#f97316' });
	tally('admin:create market', r.type === 'success' || r.type === 'redirect', JSON.stringify(r).slice(0, 200));
}
const created = await prisma.market.findMany({ where: { question: { in: questions } }, select: { id: true, question: true } });
for (const m of created) {
	const r = await act('/moderate?/approve', admin.session, { marketId: m.id });
	tally('admin:approve market', r.type === 'success' || r.type === 'redirect', JSON.stringify(r).slice(0, 200));
}
console.log(`Created and approved ${created.length} markets, closing in ${MINUTES} min.`);

// Bots trade at random until close: buys, and sells of part of a position.
const endAt = Date.parse(closeAt);
// The same rules the app enforces, so bots only send trades it will accept.
const trades = async () => {
	while (Date.now() < endAt - 5_000) {
		const bot = pick(bots);
		const open = await prisma.market.findMany({ where: { id: { in: created.map((m) => m.id) }, status: 'open' }, include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' } } } });
		if (!open.length) return;
		const market = pick(open);
		const q = market.outcomes.map((o) => o.q.toNumber());
		const spent = (await prisma.position.aggregate({ where: { userId: bot.id, marketId: market.id }, _sum: { netSpent: true } }))._sum.netSpent ?? 0;
		const holding = await prisma.position.findFirst({ where: { userId: bot.id, marketId: market.id, shares: { gt: 0 } } });
		const i = holding ? market.outcomes.findIndex((o) => o.id === holding.outcomeId) : -1;
		if (holding && Math.random() < 0.3) {
			// A sale must pay at least one whole coin after the fee; if half the holding would not, sell all of it instead.
			const held = Number(holding.shares);
			const payout = (shares: number) => netOfFee(floorCoins(proceedsForSell(q, market.b, i, shares)));
			const shares = payout(held / 2) >= 1 ? held / 2 : held;
			if (payout(shares) < 1) {
				await sleep(2_500);
				continue;
			}
			const r = await act(`/markets/${market.id}?/sell`, bot.session, { outcomeId: holding.outcomeId, shares, minProceeds: 0, key: randomUUID() });
			tally('bot:sell', r.type === 'success', JSON.stringify(r).slice(0, 200));
		} else {
			// Never spend past the market's per-member cap (netSpent is what the app counts against it).
			const room = (market.spendCap ?? DEFAULT_SPEND_CAP) - spent;
			const spend = Math.min(5 + Math.floor(Math.random() * 60), room);
			if (spend < 1) {
				await sleep(2_500);
				continue;
			}
			const outcome = pick(market.outcomes);
			const r = await act(`/markets/${market.id}?/buy`, bot.session, { outcomeId: outcome.id, spend, minShares: 0, key: randomUUID() });
			tally('bot:buy', r.type === 'success', JSON.stringify(r).slice(0, 200));
		}
		// The app allows 30 trades a minute per member: each bot waits about 2.5 s between trades.
		await sleep(2_500 + Math.random() * 500);
	}
};
await Promise.all(bots.map(() => trades()));
console.log('Trading window closed.');

// Resolution: the bot resolver proposes a winner for each market, the admin accepts it.
for (const m of created) {
	const outcomes = await prisma.outcome.findMany({ where: { marketId: m.id, removedAt: null } });
	const winner = pick(outcomes);
	await grantResolver(prisma, { marketId: m.id, userId: resolver.id, adminId: admin.id }).catch((e) => tally('admin:grant resolver', false, String(e.message)));
	const p = await act(`/resolve?/resolve`, resolver.session, { marketId: m.id, outcomeId: winner.id, evidence: 'Simulation result' });
	tally('bot:propose result', p.type === 'success' || p.type === 'redirect', JSON.stringify(p).slice(0, 200));
	const proposal = await prisma.resolutionProposal.findFirst({ where: { marketId: m.id }, orderBy: { id: 'desc' } });
	if (proposal) {
		const a = await act('/moderate?/accept', admin.session, { proposalId: proposal.id });
		tally('admin:accept result', a.type === 'success' || a.type === 'redirect', JSON.stringify(a).slice(0, 200));
	}
}

// Invariants: the ledger must balance once the run is over.
const problems = await checkLedger(prisma);
console.log('\nResults by action:');
for (const [name, s] of Object.entries(stats)) console.log(`  ${name.padEnd(22)} ok ${s.ok}  failed ${s.failed}${s.errors.length ? `\n    e.g. ${s.errors.join('\n         ')}` : ''}`);
console.log(problems.length ? `\nLedger problems:\n  ${problems.join('\n  ')}` : '\nLedger balances: no problems.');
await prisma.$disconnect();
