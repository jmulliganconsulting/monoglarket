import { prisma } from '#lib/server/db.ts';
import { BOARDS, board, type BoardKey } from '../../leaderboard/boards.ts';
import { roleColour, statusBadges } from '../../badges/badges.ts';
import { ritEmail } from '../../sse/normalize.ts';

/** Picture, badges and name colour per member. Two queries for the whole page; SSE rows match on the @rit.edu form, as sseMemberForEmail does. */
async function cards(ids: number[]) {
	const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, email: true, primaryOfficerSince: true } });
	const plain = (email: string) => ritEmail(email.trim().toLowerCase());
	const emails = users.flatMap((u) => (u.email ? [plain(u.email), plain(u.email).replace(/@rit\.edu$/, '@g.rit.edu')] : []));
	const sse = await prisma.sseMember.findMany({ where: { email: { in: emails }, removedAt: null }, select: { email: true, imageFile: true, status: true, isMentor: true, isMember: true, membershipCount: true } });
	const byEmail = new Map(sse.map((m) => [plain(m.email), m]));
	return new Map(
		users.map((u) => {
			const member = (u.email && byEmail.get(plain(u.email))) || null;
			const badges = statusBadges(u, member);
			return [u.id, { image: member?.imageFile ?? null, badges, colour: roleColour(badges) }] as const;
		}),
	);
}

export async function load({ url }) {
	const currencies = await prisma.currency.findMany({ where: { kind: 'internal', active: true }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
	const current = currencies.find((c) => c.code === url.searchParams.get('currency')) ?? currencies[0] ?? null;
	// Seasons (FR-14): the newest one that has started is the default. Season profit counts from its start.
	const seasons = await prisma.season.findMany({ where: { startsAt: { lte: new Date() } }, orderBy: { startsAt: 'desc' }, select: { id: true, name: true, startsAt: true } });
	const season = seasons.find((s) => String(s.id) === url.searchParams.get('season')) ?? seasons[0] ?? null;
	const key = (Object.keys(BOARDS).includes(url.searchParams.get('board') ?? '') ? url.searchParams.get('board') : 'worth') as BoardKey;
	const result = current ? await board(prisma, current.id, key, season?.startsAt) : { label: BOARDS[key].label, rows: [] };
	const people = await cards(result.rows.map((r) => r.id));
	return {
		boards: Object.entries(BOARDS).map(([k, b]) => ({ key: k, label: b.label })),
		board: key,
		unit: BOARDS[key].unit(current?.code ?? ''),
		currencies: currencies.map((c) => ({ code: c.code, name: c.name })),
		current: current && { code: current.code, name: current.name },
		seasons,
		season,
		rows: result.rows.map((r) => ({ ...r, image: null, badges: [], colour: undefined, ...people.get(r.id) })),
	};
}
