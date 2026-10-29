// Mirrors the SSE website's users, officers, mentors and memberships into sse_members / sse_officers / sse_degrees.
// Uses the site's five bulk GETs: /api/user (now 403 without a login), /api/officer (every role, past and present), /api/officer-positions
// (each position and its current holder, recorded per RIT term in sse_officer_terms), /api/mentor?detailed=true
// (active and inactive mentors, each with their latest application; plain /api/mentor, without applications, if that fails), /api/memberships; plus /api/user/{id}/profile, the only source of each membership's reason and date, fetched
// only for users whose membership count changed or whose copy is a week old. Every request to the site is rate limited and carries
// the User-Agent and (when set) bearer token (politeFetch). A failing bulk GET is logged and its part of the mirror left as it was; the rest still sync.
// Nothing is deleted: users, roles, mentor records and memberships that vanish from the site get removedAt instead.
// Status rules copy the site's next/lib/authLevelResolver.ts: active officer > active mentor > >= 1 membership ever > guest.
// Events (/api/event) and their check-ins (/api/event/{id}/attendance) are mirrored too, see syncEvents.
// Two phases: syncSse writes the roster with pure clean-ups (normalize.ts); enrichSse then does the slow network lookups
// (GitHub, profile pictures) only for rows that are new, changed, or due a recheck.
import { setTimeout as sleep } from 'node:timers/promises';
import type { PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { cleanLine, cleanName, cleanText, gitHubLogin, linkedInSlug, nameLooksFake, parseMajors } from './normalize.ts';
import { TEST_ACCOUNT_IDS } from './test-accounts.ts';
import { cleanLocation, parsePlaces } from './locations.ts';
import { CATEGORIES, classifyEvent, seriesKey } from './categories.ts';
import { fetchRitTerms, resolveGitHub, ritTermCode, saveImage, type Fetch, type Lookup } from './resolve.ts';

// SE Staff: an active SE_OFFICE holder. Earns from memberships like anyone; is not a Member (no elections).
export type SseStatus = 'se_staff' | 'officer' | 'mentor' | 'member' | 'guest';

export type SyncOptions = {
	baseUrl: string;
	/** Where profile picture copies go (served by /sse-images/[file]). */
	imageDir: string;
	ritApiKey?: string;
	gitHubToken?: string;
	/** Bearer token for SSE endpoints that need a login. */
	sseToken?: string;
	/** User-Agent sent to the SSE site. */
	userAgent?: string;
	fetchFn?: Fetch;
	lookup?: Lookup;
	/** Minimum gap between requests to the SSE site (default 500 ms, i.e. at most 2 per second). */
	requestGapMs?: number;
};

type SseUser = { id: number; name: string; email: string; major?: string | null; graduationTerm?: string | null; graduationYear?: number | null; linkedIn?: string | null; gitHub?: string | null; image?: string | null; description?: string | null; coopSummary?: string | null; membershipCount?: number };
type SseOfficerRow = { id: number; is_active: boolean; start_date: string | null; end_date: string | null; user: { id: number }; position: { id?: number; title: string; is_primary: boolean } };
type SsePositionRow = { id: number; title: string; is_primary: boolean; category?: string | null; is_defunct?: boolean; email?: string | null; currentOfficer?: { id: number; userId: number } | null };
type SseMentorRow = { id: number; isActive: boolean; expirationDate: string; user: { id: number }; latestMentorApplication?: SseApplication | null };
type SseApplication = { id: number; semester?: { id?: number; name?: string } | null; createdAt?: string } & Record<string, unknown>;
type SseTermCount = { userId: number; membershipCount: number };
// Non-members get memberships: [] or null or no key at all; officerRoles / mentorProfile duplicate /api/officer and /api/mentor.
type SseEventRow = { id: string; title: string; description?: string | null; date: string; image?: string | null; location?: string | null; attendanceEnabled?: boolean; grantsMembership?: boolean };
type SseAttendance = { attendees: { id: number; userId: number; attendedAt: string }[] };
type SseProfile = { memberships?: { id: number; reason: string; dateGiven: string }[] | null; isOwner?: boolean };

const RECHECK_MS = 7 * 86_400_000; // GitHub re-verified, failed images retried, at most weekly

/**
 * Rate limit for the SSE site, which doesn't limit these GETs itself: requests start at least gapMs apart, and a 429/503
 * waits out Retry-After (default 30 s, max 5 min) up to 3 tries. Requests to other hosts pass straight through.
 */
export function politeFetch(fetchFn: Fetch, baseUrl: string, gapMs: number, headers: Record<string, string> = {}): Fetch {
	const host = new URL(baseUrl).host;
	let queue: Promise<unknown> = Promise.resolve();
	const turn = (ms: number) => {
		const mine = queue;
		queue = queue.then(() => sleep(ms));
		return mine;
	};
	return (async (input: URL | string | Request, init?: RequestInit) => {
		if (new URL(input instanceof Request ? input.url : input).host !== host) return fetchFn(input, init);
		const h = new Headers(init?.headers);
		for (const [k, v] of Object.entries(headers)) h.set(k, v);
		init = { ...init, headers: h };
		for (let attempt = 1; ; attempt++) {
			await turn(gapMs);
			const res = await fetchFn(input, init);
			if ((res.status !== 429 && res.status !== 503) || attempt === 3) return res;
			const after = Number(res.headers.get('retry-after') ?? NaN); // seconds; the HTTP-date form falls back to 30
			await turn(Math.min(Number.isFinite(after) ? after : 30, 300) * 1000);
		}
	}) as Fetch;
}

/** JSON from the SSE site; null on 404. */
async function getJson(fetchFn: Fetch, base: string, path: string): Promise<unknown> {
	const res = await fetchFn(new URL(path, base), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`SSE ${path}: HTTP ${res.status}`);
	return res.json();
}

async function get<T>(fetchFn: Fetch, base: string, path: string): Promise<T[]> {
	const body = await getJson(fetchFn, base, path);
	if (!Array.isArray(body)) throw new Error(`SSE ${path}: expected an array`);
	return body;
}

/** get, but a failure (or an empty list, which means the site broke, not that everything was deleted) is logged and gives null. */
async function tryGet<T>(fetchFn: Fetch, base: string, path: string): Promise<T[] | null> {
	try {
		const rows = await get<T>(fetchFn, base, path);
		if (rows.length) return rows;
		console.warn(`SSE ${path}: empty; keeping previous data`);
	} catch (e) {
		console.warn(`${(e as Error).message}; keeping previous data`);
	}
	return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
// shortcut: fixed month cut-offs (Jan-May Spring, Jun-Jul Summer, Aug-Dec Fall); switch to the RIT terms' start/end dates if a role near a boundary misfiles.
const SEASONS = [['SPRING', 'Spring', 0, 5], ['SUMMER', 'Summer', 5, 7], ['FALL', 'Fall', 7, 12]] as const; // start month, end month (exclusive)
const termAt = (season: (typeof SEASONS)[number], year: number) => ({ term: `${season[1]} ${year}`, season: season[0], year, start: new Date(year, season[2], 1), end: new Date(year, season[3], 1) });

/** The RIT term a date falls in, e.g. { term: 'Fall 2026', season: 'FALL', year: 2026, start, end }. */
export function termOf(d: Date) {
	return termAt(SEASONS.find((s) => d.getMonth() < s[3])!, d.getFullYear());
}

/**
 * Terms a role held from start to end counts toward: those it covers for at least a third, which drops the site's minutes-long
 * corrections and a successor's last few weeks, but keeps both sides of a mid-term handover. Only terms that have begun by now.
 */
export function termsServed(start: Date, end: Date, now: Date) {
	const out: ReturnType<typeof termAt>[] = [];
	for (let year = start.getFullYear(); year <= Math.min(end.getFullYear(), now.getFullYear()); year++)
		for (const s of SEASONS) {
			const t = termAt(s, year);
			if (t.start > now) break;
			if (Math.min(+t.end, +end) - Math.max(+t.start, +start) >= (+t.end - +t.start) / 3) out.push(t);
		}
	return out;
}

const date = (v: unknown) => {
	const d = v ? new Date(v as string) : null;
	return d && !isNaN(d.getTime()) ? d : null;
};

/** Full refresh: roster, membership details, then lookups. */
export async function syncSse(prisma: PrismaClient, opts: SyncOptions) {
	const headers = { 'user-agent': opts.userAgent ?? 'Monoglarket-sync', ...(opts.sseToken && { authorization: `Bearer ${opts.sseToken}` }) };
	opts = { ...opts, fetchFn: politeFetch(opts.fetchFn ?? fetch, opts.baseUrl, opts.requestGapMs ?? 500, headers) };
	const roster = await syncRoster(prisma, opts);
	const summary = { ...roster, ...(await syncProfiles(prisma, opts)), ...(await syncEvents(prisma, opts)), ...(await enrichSse(prisma, opts)) };
	await audit(prisma, null, 'sse_sync', null, JSON.stringify(summary));
	return summary;
}

/** Pull everything first, then write in one transaction. An endpoint that fails (null) leaves the tables it feeds untouched. */
export async function syncRoster(prisma: PrismaClient, opts: SyncOptions) {
	const fetchFn = opts.fetchFn ?? fetch;
	const [users, officers, positions, mentors, termCounts] = await Promise.all([
		tryGet<SseUser>(fetchFn, opts.baseUrl, '/api/user'),
		tryGet<SseOfficerRow>(fetchFn, opts.baseUrl, '/api/officer'),
		tryGet<SsePositionRow>(fetchFn, opts.baseUrl, '/api/officer-positions'),
		tryGet<SseMentorRow>(fetchFn, opts.baseUrl, '/api/mentor?detailed=true').then((r) => r ?? tryGet<SseMentorRow>(fetchFn, opts.baseUrl, '/api/mentor')),
		tryGet<SseTermCount>(fetchFn, opts.baseUrl, '/api/memberships'),
	]);
	// External data: keep only rows with the fields we key on.
	const valid = users?.filter((u) => Number.isInteger(u?.id) && u.id >= 0 && typeof u.email === 'string' && u.email.includes('@')) ?? [];
	// No usable users almost certainly means the site broke, not that everyone left; don't flag the table as removed.
	if (users && !valid.length) console.warn('SSE /api/user: no valid users; keeping previous data');
	// Status needs all three role lists; with one missing, members keep their last status.
	const rolesKnown = !!(officers && positions && mentors);
	// Term numbers are nice-to-have: an RIT API outage falls back to the code pattern rather than failing the sync.
	const termCodes = opts.ritApiKey ? await fetchRitTerms(opts.ritApiKey, fetchFn).catch(() => new Map<string, string>()) : new Map<string, string>();

	const term = new Map(termCounts?.map((t) => [t.userId, t.membershipCount]));
	const mentorUntil = new Map<number, Date>();
	for (const m of mentors ?? []) {
		if (!m?.isActive || !Number.isInteger(m.user?.id)) continue;
		const until = new Date(m.expirationDate);
		const prev = mentorUntil.get(m.user.id);
		if (!prev || until > prev) mentorUntil.set(m.user.id, until);
	}
	const officerIds = new Set(officers?.filter((o) => o?.is_active).map((o) => o.user?.id));
	const seOfficePosts = new Set(positions?.filter((p) => p.category === 'SE_OFFICE').map((p) => p.id));
	const seStaffIds = new Set(officers?.filter((o) => o?.is_active && seOfficePosts.has(o.position?.id ?? -1)).map((o) => o.user?.id));
	const before = new Map((await prisma.sseMember.findMany({ select: { id: true, gitHubGiven: true, imageGiven: true, majorGiven: true, linkedInSlugManual: true } })).map((m) => [m.id, m]));
	const now = new Date();

	return prisma.$transaction(
		async (db) => {
			for (const u of valid) {
				const old = before.get(u.id);
				const membershipCount = u.membershipCount ?? 0;
				const seStaff = seStaffIds.has(u.id);
				const status: SseStatus = seStaff ? 'se_staff' : officerIds.has(u.id) ? 'officer' : mentorUntil.has(u.id) ? 'mentor' : membershipCount >= 1 ? 'member' : 'guest';
				const slug = old?.linkedInSlugManual ?? linkedInSlug(u.linkedIn); // an admin's slug (sse:link) wins
				const gitHubGiven = u.gitHub ?? null;
				const imageGiven = u.image ?? null;
				const majorGiven = u.major ?? null;
				const name = cleanName(String(u.name ?? ''));
				const data = {
					email: u.email.trim().toLowerCase(),
					name,
					nameGiven: u.name ?? null,
					nameSuspect: nameLooksFake(name),
					isTestAccount: TEST_ACCOUNT_IDS.has(u.id),
					graduationTerm: u.graduationTerm ?? null,
					graduationYear: u.graduationYear ?? null,
					graduationTermCode: ritTermCode(termCodes, u.graduationTerm ?? null, u.graduationYear ?? null),
					description: cleanText(u.description),
					coopSummary: cleanText(u.coopSummary),
					majorGiven,
					linkedInGiven: u.linkedIn ?? null,
					resolvedLinkedIn: slug,
					linkedInValid: slug !== null,
					gitHubGiven,
					imageGiven,
					membershipCount,
					...(termCounts && { termMembershipCount: term.get(u.id) ?? 0 }),
					membershipFetchedAt: now,
					...(rolesKnown && { isMember: membershipCount > 0 && !seStaff, isMentor: mentorUntil.has(u.id), mentorExpiresAt: mentorUntil.get(u.id) ?? null, status }),
					syncedAt: now,
					removedAt: null,
					// A new GitHub value is unverified until enrichSse checks it.
					...(old?.gitHubGiven !== gitHubGiven && { resolvedGitHub: null, gitHubValid: false, gitHubId: null, gitHubCheckedAt: null }),
					// A new picture URL gets fetched; the old copy stays until the new one lands.
					...(old?.imageGiven !== imageGiven && { imageCheckedAt: null, imageError: null }),
				};
				await db.sseMember.upsert({ where: { id: u.id }, create: { id: u.id, ...data }, update: data });
				if (!old || old.majorGiven !== majorGiven) {
					await db.sseDegree.deleteMany({ where: { memberId: u.id } });
					await db.sseDegree.createMany({ data: parseMajors(majorGiven).map((d, sort) => ({ memberId: u.id, sort, ...d })) });
				}
			}
			// Users deleted on the SSE site. Without the user list, the members we already have stand in for it.
			if (valid.length) await db.sseMember.updateMany({ where: { syncedAt: { lt: now }, removedAt: null }, data: { removedAt: now } });
			const ids = valid.length ? new Set(valid.map((u) => u.id)) : new Set(before.keys());
			const roles = (officers ?? []).filter((o) => Number.isInteger(o?.id) && ids.has(o.user?.id) && typeof o.position?.title === 'string');
			for (const o of roles) {
				const data = {
					memberId: o.user.id,
					positionId: o.position.id ?? null,
					title: o.position.title,
					isPrimary: !!o.position.is_primary,
					isActive: !!o.is_active,
					startDate: date(o.start_date),
					endDate: date(o.end_date),
					removedAt: null,
				};
				await db.sseOfficer.upsert({ where: { sseOfficerId: o.id }, create: { sseOfficerId: o.id, ...data }, update: data });
			}
			if (officers) await db.sseOfficer.updateMany({ where: { sseOfficerId: { notIn: roles.map((o) => o.id) }, removedAt: null }, data: { removedAt: now } });
			const posts = (positions ?? []).filter((p) => Number.isInteger(p?.id) && typeof p.title === 'string');
			// Retired positions (Branding Head, ...) appear only on old roles; give them a row so their terms count too.
			const listed = new Set(posts.map((p) => p.id));
			const retired = new Map(roles.filter((o) => Number.isInteger(o.position.id) && !listed.has(o.position.id!)).map((o) => [o.position.id!, o.position]));
			for (const [id, p] of positions ? retired : []) {
				const data = { title: p.title, isPrimary: !!p.is_primary, syncedAt: now };
				await db.sseOfficerPosition.upsert({ where: { id }, create: { id, ...data, isDefunct: true, removedAt: now }, update: data });
			}
			const code = (t: { season: string; year: number }) => ritTermCode(termCodes, t.season, t.year);
			const current = termOf(now);
			for (const p of posts) {
				const holder = p.currentOfficer && Number.isInteger(p.currentOfficer.id) && ids.has(p.currentOfficer.userId) ? p.currentOfficer : null;
				const data = {
					title: p.title,
					isPrimary: !!p.is_primary,
					category: str(p.category),
					isDefunct: !!p.is_defunct,
					email: str(p.email),
					currentOfficerId: holder?.id ?? null,
					syncedAt: now,
					removedAt: null,
				};
				await db.sseOfficerPosition.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
				if (!holder) continue;
				const key = { term: current.term, positionId: p.id, sseOfficerId: holder.id };
				const seen = { termCode: code(current), memberId: holder.userId, lastSeenAt: now };
				await db.sseOfficerTerm.upsert({ where: { term_positionId_sseOfficerId: key }, create: { ...key, ...seen }, update: seen });
			}
			// After the positions exist (foreign key); needs both lists, or a position seen only on a role may be missing.
			if (officers && positions) await db.sseOfficerTerm.updateMany({ where: { fromDates: true }, data: { fromDates: false } });
			for (const o of officers && positions ? roles : []) {
				const start = date(o.start_date);
				const end = date(o.end_date) ?? (o.is_active ? now : null);
				if (!Number.isInteger(o.position.id) || !start || !end) continue;
				for (const t of termsServed(start, end, now)) {
					const key = { term: t.term, positionId: o.position.id!, sseOfficerId: o.id };
					const data = { termCode: code(t), memberId: o.user.id, fromDates: true };
					await db.sseOfficerTerm.upsert({ where: { term_positionId_sseOfficerId: key }, create: { ...key, ...data }, update: data });
				}
			}
			if (positions) await db.sseOfficerPosition.updateMany({ where: { id: { notIn: [...listed] }, removedAt: null }, data: { removedAt: now } });
			const mentorRows = (mentors ?? []).filter((m) => Number.isInteger(m?.id) && ids.has(m.user?.id));
			for (const m of mentorRows) {
				const data = { memberId: m.user.id, isActive: !!m.isActive, expirationDate: date(m.expirationDate), removedAt: null };
				await db.sseMentor.upsert({ where: { id: m.id }, create: { id: m.id, ...data }, update: data });
				// Only the latest application is public; earlier semesters' rows stay as last seen.
				const a = m.latestMentorApplication;
				if (!Number.isInteger(a?.id)) continue;
				const app = {
					memberId: m.user.id,
					semesterId: Number.isInteger(a!.semester?.id) ? a!.semester!.id! : null,
					semesterName: str(a!.semester?.name),
					status: str(a!.status),
					discordUsername: str(a!.discordUsername),
					pronouns: str(a!.pronouns),
					major: str(a!.major),
					yearLevel: str(a!.yearLevel),
					coursesJson: str(a!.coursesJson),
					skillsText: str(a!.skillsText),
					toolsComfortable: str(a!.toolsComfortable),
					toolsLearning: str(a!.toolsLearning),
					previousSemesters: Number.isInteger(a!.previousSemesters) ? (a!.previousSemesters as number) : null,
					whyMentor: str(a!.whyMentor),
					comments: str(a!.comments),
					appliedAt: date(a!.createdAt),
					syncedAt: now,
				};
				await db.sseMentorApplication.upsert({ where: { id: a!.id }, create: { id: a!.id, ...app }, update: app });
			}
			if (mentors) await db.sseMentor.updateMany({ where: { id: { notIn: mentorRows.map((m) => m.id) }, removedAt: null }, data: { removedAt: now } });
			return { members: valid.length, officers: roles.filter((o) => o.is_active).length, officerRoles: roles.length, positions: posts.length, vacant: posts.filter((p) => !p.currentOfficer).length, mentors: mentorUntil.size };
		},
		{ timeout: 120_000 }, // a few thousand upserts outlast Prisma's 5 s default
	);
}

/**
 * Membership details (reason, date) and isOwner from each user's profile: one request per user, so only for users never read,
 * whose live membership rows don't match /api/user's count, or last read over a week ago. Stops at the first failure; the rest retry next sync.
 */
export async function syncProfiles(prisma: PrismaClient, opts: SyncOptions) {
	const fetchFn = opts.fetchFn ?? fetch;
	const stale = new Date(Date.now() - RECHECK_MS);
	const members = await prisma.sseMember.findMany({
		where: { removedAt: null },
		select: { id: true, membershipCount: true, profileFetchedAt: true, _count: { select: { memberships: { where: { removedAt: null } } } } },
	});
	let profilesFetched = 0;
	for (const m of members) {
		if (m.profileFetchedAt && m.profileFetchedAt >= stale && m._count.memberships === m.membershipCount) continue;
		let p: SseProfile | null;
		try {
			p = (await getJson(fetchFn, opts.baseUrl, `/api/user/${m.id}/profile`)) as SseProfile | null;
		} catch (e) {
			console.warn(`SSE profiles: stopping (${(e as Error).message}); the rest retry next sync`);
			break;
		}
		if (!p) continue; // deleted since the roster pull; the next roster marks it removed
		const list = (Array.isArray(p.memberships) ? p.memberships : []).filter((x) => Number.isInteger(x?.id) && date(x.dateGiven));
		const now = new Date();
		await prisma.$transaction(async (db) => {
			for (const x of list) {
				const data = { memberId: m.id, reason: String(x.reason ?? ''), dateGiven: date(x.dateGiven)!, removedAt: null };
				await db.sseMembership.upsert({ where: { id: x.id }, create: { id: x.id, ...data }, update: data });
			}
			await db.sseMembership.updateMany({ where: { memberId: m.id, id: { notIn: list.map((x) => x.id) }, removedAt: null }, data: { removedAt: now } });
			await db.sseMember.update({ where: { id: m.id }, data: { isOwner: typeof p.isOwner === 'boolean' ? p.isOwner : null, profileFetchedAt: now } });
		});
		profilesFetched++;
	}
	return { profilesFetched };
}

const CHECKIN_EARLY_MS = 15 * 60_000; // the SSE site opens check-in 15 minutes before an event
const RECENT_EVENT_MS = 14 * 86_400_000;

/**
 * Every event, then check-ins for events that track attendance and have opened check-in: never read, within two weeks of their date
 * (check-ins still arriving or being corrected), or last read over a week ago.
 * Note: for an ended event that grants a membership, reading attendance makes the SSE site create any memberships it owes
 * (reconcileEndedEventMemberships). That's idempotent and what any visitor to the page triggers, but it is a write on their side.
 */
export async function syncEvents(prisma: PrismaClient, opts: SyncOptions) {
	const fetchFn = opts.fetchFn ?? fetch;
	const rows = (await tryGet<SseEventRow>(fetchFn, opts.baseUrl, '/api/event'))?.filter((e) => typeof e?.id === 'string' && e.id && date(e.date));
	if (!rows?.length) return { events: 0, attendanceFetched: 0, checkins: 0 };
	const now = new Date();
	const before = new Map((await prisma.sseEvent.findMany({ select: { id: true, image: true, places: { orderBy: { sort: 'asc' }, select: { place: true, room: true, role: true } } } })).map((e) => [e.id, e]));
	// Same series, different spellings ("PowerPoint Karaoke" / "Power Point Karaoke"): every event gets the most common one.
	const kinds = new Map(rows.map((e) => [e.id, classifyEvent(String(e.title ?? ''))]));
	const spellings = new Map<string, Map<string, number>>();
	for (const { series } of kinds.values()) {
		const m = spellings.get(seriesKey(series)) ?? new Map<string, number>();
		spellings.set(seriesKey(series), m.set(series, (m.get(series) ?? 0) + 1));
	}
	const spelling = (series: string) => [...spellings.get(seriesKey(series))!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
	await prisma.$transaction(
		async (db) => {
			// CATEGORIES is the source of truth: names, owners and order follow the code. Keys dropped from the code stay (events point at them).
			for (const { match: _, ...c } of CATEGORIES) await db.eventCategory.upsert({ where: { key: c.key }, create: c, update: c });
			for (const e of rows) {
				const when = date(e.date)!;
				const locationGiven = str(e.location);
				const image = str(e.image)?.trim() || null;
				const kind = kinds.get(e.id)!;
				const data = {
					title: cleanLine(String(e.title ?? '')) || e.id,
					description: cleanText(e.description),
					date: when,
					image,
					...(before.get(e.id)?.image !== image && { imageCheckedAt: null, imageError: null }),
					category: kind.category,
					series: spelling(kind.series),
					locationGiven,
					location: cleanLocation(locationGiven),
					attendanceEnabled: e.attendanceEnabled === true,
					grantsMembership: e.grantsMembership === true,
					syncedAt: now,
					removedAt: null,
				};
				await db.sseEvent.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data });
				// Re-parsed every sync, so a change to the location rules reaches old events too; written only when the result changed.
				const places = parsePlaces(locationGiven, when);
				if (JSON.stringify(places) === JSON.stringify(before.get(e.id)?.places ?? [])) continue;
				await db.sseEventPlace.deleteMany({ where: { eventId: e.id } });
				await db.sseEventPlace.createMany({ data: places.map((pl, sort) => ({ eventId: e.id, sort, ...pl })) });
			}
			await db.sseEvent.updateMany({ where: { id: { notIn: rows.map((e) => e.id) }, removedAt: null }, data: { removedAt: now } });
		},
		{ timeout: 120_000 },
	);

	const recheck = new Date(now.getTime() - RECHECK_MS);
	const due = await prisma.sseEvent.findMany({
		where: {
			attendanceEnabled: true,
			removedAt: null,
			date: { lte: new Date(now.getTime() + CHECKIN_EARLY_MS) },
			OR: [{ attendanceFetchedAt: null }, { date: { gte: new Date(now.getTime() - RECENT_EVENT_MS) } }, { attendanceFetchedAt: { lt: recheck } }],
		},
		select: { id: true },
	});
	const members = new Set((await prisma.sseMember.findMany({ select: { id: true } })).map((m) => m.id));
	let attendanceFetched = 0;
	let checkins = 0;
	for (const ev of due) {
		let a: SseAttendance | null;
		try {
			a = (await getJson(fetchFn, opts.baseUrl, `/api/event/${encodeURIComponent(ev.id)}/attendance`)) as SseAttendance | null;
		} catch (e) {
			console.warn(`SSE attendance: stopping (${(e as Error).message}); the rest retry next sync`);
			break;
		}
		if (!a) continue; // deleted since the list; the next sync marks it removed
		// A member who signed up after this sync's roster pull is picked up next time.
		const list = (Array.isArray(a.attendees) ? a.attendees : []).filter((x) => Number.isInteger(x?.id) && members.has(x.userId) && date(x.attendedAt));
		const at = new Date();
		await prisma.$transaction(async (db) => {
			for (const x of list) {
				const data = { eventId: ev.id, memberId: x.userId, attendedAt: date(x.attendedAt)!, removedAt: null };
				await db.sseEventAttendance.upsert({ where: { id: x.id }, create: { id: x.id, ...data }, update: data });
			}
			await db.sseEventAttendance.updateMany({ where: { eventId: ev.id, id: { notIn: list.map((x) => x.id) }, removedAt: null }, data: { removedAt: at } });
			await db.sseEvent.update({ where: { id: ev.id }, data: { attendanceFetchedAt: at } });
		});
		attendanceFetched++;
		checkins += list.length;
	}
	return { events: rows.length, attendanceFetched, checkins };
}

/** A Google Drive share link (drive.google.com/file/d/ID/view) serves a page; its thumbnail URL serves the image. Other URLs pass through. */
export const driveImage = (url: string) => url.replace(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/.*$/, 'https://drive.google.com/thumbnail?id=$1&sz=w1600');

/** GitHub checks and picture downloads for rows that need them. Safe to run any time; does nothing when all is fresh. */
export async function enrichSse(prisma: PrismaClient, opts: SyncOptions) {
	const stale = new Date(Date.now() - RECHECK_MS);
	let gitHubChecked = 0;
	const toCheck = await prisma.sseMember.findMany({
		where: { gitHubGiven: { not: null }, OR: [{ gitHubCheckedAt: null }, { gitHubCheckedAt: { lt: stale } }] },
		select: { id: true, gitHubGiven: true },
	});
	for (const m of toCheck) {
		const login = gitHubLogin(m.gitHubGiven);
		let found: Awaited<ReturnType<typeof resolveGitHub>> = null;
		if (login) {
			try {
				found = await resolveGitHub(login, { token: opts.gitHubToken, fetchFn: opts.fetchFn });
			} catch (e) {
				console.warn(`SSE enrich: stopping GitHub checks (${(e as Error).message}); the rest retry next sync`);
				break; // rate-limited or GitHub down
			}
		}
		await prisma.sseMember.update({
			where: { id: m.id },
			data: { resolvedGitHub: found?.login ?? null, gitHubId: found?.id ?? null, gitHubValid: !!found, gitHubCheckedAt: new Date() },
		});
		gitHubChecked++;
	}

	// Profile pictures and event images: new/changed URLs, plus failed ones once a week. Successful copies are never refetched: the source may vanish.
	const due = { OR: [{ imageCheckedAt: null }, { imageFile: null, imageCheckedAt: { lt: stale } }] };
	const toFetch = [
		...(await prisma.sseMember.findMany({ where: { imageGiven: { not: null }, ...due }, select: { id: true, imageGiven: true } })).map((m) => ({ url: m.imageGiven!, save: (data: object) => prisma.sseMember.update({ where: { id: m.id }, data }) })),
		...(await prisma.sseEvent.findMany({ where: { image: { not: null }, ...due }, select: { id: true, image: true } })).map((e) => ({ url: driveImage(e.image!), save: (data: object) => prisma.sseEvent.update({ where: { id: e.id }, data }) })),
	];
	let imagesSaved = 0;
	const queue = [...toFetch];
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			for (let m; (m = queue.shift()); ) {
				const data = await saveImage(m.url, { baseUrl: opts.baseUrl, dir: opts.imageDir, fetchFn: opts.fetchFn, lookup: opts.lookup }).then(
					(imageFile) => (imagesSaved++, { imageFile, imageError: null }),
					(e: Error) => ({ imageError: e.message.slice(0, 500) }),
				);
				await m.save({ ...data, imageCheckedAt: new Date() });
			}
		}),
	);
	return { gitHubChecked, imagesSaved, imagesFailed: toFetch.length - imagesSaved };
}

/** A local user's SSE standing, joined on email, with role / mentor / membership history; null = not on the SSE site (or not synced yet). */
export function sseMemberByEmail(prisma: PrismaClient, email: string) {
	return prisma.sseMember.findFirst({
		where: { email: email.trim().toLowerCase(), removedAt: null },
		include: {
			positions: { orderBy: { startDate: 'desc' } },
			officerTerms: { orderBy: [{ termCode: 'desc' }, { positionId: 'asc' }], include: { position: true } },
			mentors: true,
			mentorApplications: { orderBy: { appliedAt: 'desc' } },
			memberships: { orderBy: { dateGiven: 'desc' } },
			degrees: { orderBy: { sort: 'asc' } },
		},
	});
}
