// What kind each SSE event is, from its title (the SSE site doesn't say who set an event up). classifyEvent works in three steps:
//   1. company: a known company (COMPANIES) or a company cue ("visit", "info session") makes it a company event, series = the company.
//      Checked first, so a company's résumé workshop or tech talk is never filed as career or talk, and can be weighted on its own.
//   2. category: the first CATEGORIES entry whose `match` fits. The list is in matching order: narrow kinds before broad nets.
//   3. series: the first SERIES rule that fits, else the title minus decoration (DECORATION), so repeats of one event group together.
// The sync stores the result as SseEvent.category/series on every run; categoryManual/seriesManual, set by an admin, always win.
// A new kind, company, spelling or recurring event should only ever need a row in one of the tables below.
import { cleanLine } from './normalize.ts';

/**
 * The categories, in matching order. Synced into event_categories every run (this list is the source of truth).
 * runBy = the SSE officer position that usually runs them; sort = display order.
 */
export const CATEGORIES = [
	{ key: 'election', name: 'Elections', runBy: null, description: 'Run by the club as a whole, not one position', sort: 11, match: /nominat|voting|ballot|election/i },
	{ key: 'officer', name: 'Officer meetings', runBy: null, description: null, sort: 10, match: /officer meeting|primary officer|dept\.? meeting|committee meeting/i },
	{ key: 'general_meeting', name: 'General meetings', runBy: 'President', description: null, sort: 1, match: /general meeting|gen\.? meet/i },
	{ key: 'lab', name: 'Lab upkeep', runBy: 'Laboratory Operations', description: null, sort: 9, match: /lab cleaning|clean-?up|cleanout|brochure/i },
	{
		key: 'company',
		name: 'Company talks and events',
		runBy: 'Public Relations Head',
		description: 'Public outreach: a company visits to talk, recruit or review résumés, whoever organises it',
		sort: 4,
		match: null, // step 1 decides these
	},
	{
		key: 'career',
		name: 'Career development',
		runBy: 'Career Development Head',
		description: 'Not tied to a company: résumé reviews, mock interviews, career mentoring',
		sort: 5,
		match: /r[eé]sum[eé]|mock (technical )?interview|career|elevator pitch|linkedin/i,
	},
	{ key: 'academic', name: 'Review sessions and mentoring', runBy: 'Mentoring Head', description: null, sort: 6, match: /review|practice (exam|final)|\bexam\b|mentoring/i },
	{ key: 'outreach', name: 'Open houses and club fairs', runBy: 'Public Relations Head', description: 'Formerly Student Relations, since split into Public Relations and Secretary', sort: 8, match: /open ?house|club fair|imagine ?rit|orientation/i },
	{ key: 'project', name: 'Projects', runBy: 'Projects Head', description: null, sort: 7, match: /projectbci|rapdev|website series|\bsmp\b/i },
	{
		key: 'talk',
		name: 'Talks',
		runBy: 'Talks Head',
		description: 'A member, student or professor gives a talk',
		sort: 3,
		match: /talk|workshop|intro(duction)? to|fundamentals|what is|how to|rants|^meet prof|framework|command line|programming languages|paxos|raytracer|hexcasting|r&d in|\bgit\b|docker|\bjs\b|phone power/i,
	},
	{
		key: 'social',
		name: 'Social events',
		runBy: 'Events',
		description: null,
		sort: 2,
		match: /night|party|bbq|picnic|karaoke|sardines|mafia|trivia|heist|laser ?tag|bowling|skat|hockey|movie|game|feud|jeopardy|jackbox|crafts|pumpkin|maze|climb|trampolin|darien|cook(out|off)|snowball|box fort|table flip|owl|winter ?ball|swag|popcorn|bagels|ice cream|talent|tinfoil|ask us anything|watching|graduation|hacktoberfest|brain games|chili|cards against|internship/i,
	},
	{ key: 'other', name: 'Other', runBy: null, description: 'Nothing matched; recategorise by hand', sort: 99, match: null },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** Companies that have visited, by every spelling seen. The name is the series. */
const COMPANIES: [RegExp, string][] = [
	[/willow ?tree/i, 'WillowTree'],
	[/hub ?spot/i, 'HubSpot'],
	[/constant contact/i, 'Constant Contact'],
	[/\bl3 ?harris|\blharris|\bharris\b/i, 'L3Harris'],
	[/\bbae\b/i, 'BAE Systems'],
	[/air force research/i, 'Air Force Research Lab'],
	[/microsoft/i, 'Microsoft'],
	[/\bgoogle\b/i, 'Google'],
	[/intuit/i, 'Intuit'],
	[/paychex/i, 'Paychex'],
	[/fast enterprise/i, 'FAST Enterprises'],
	[/lockheed/i, 'Lockheed Martin'],
	[/^m&t$|m&t bank/i, 'M&T Bank'],
	[/moog/i, 'Moog'],
	[/\bnsa\b/i, 'NSA'],
	[/gartner/i, 'Gartner'],
	[/corning/i, 'Corning'],
	[/core ?os/i, 'CoreOS'],
	[/expensify/i, 'Expensify'],
	[/bank of america/i, 'Bank of America'],
	[/cimpress/i, 'Cimpress'],
	[/covermymeds/i, 'CoverMyMeds'],
	[/black ?baud/i, 'Blackbaud'],
	[/benco/i, 'Benco Dental'],
	[/randstad/i, 'Randstad'],
	[/red argyle/i, 'Red Argyle'],
	[/datadog/i, 'Datadog'],
	[/cloud ?checkr/i, 'CloudCheckr'],
	[/iomaxis/i, 'IOMaxis'],
	[/ipkeys/i, 'IPKeys'],
	[/narwhal/i, 'Narwhal Systems'],
	[/utc aerospace/i, 'UTC Aerospace'],
	[/\bpowr\b/i, 'Powr'],
	[/hookbang/i, 'HookBang'],
];
/** A company event whose company isn't in COMPANIES yet; its series is the cleaned title. */
const COMPANY_CUE = /\bvisit\b|info session|meet (and|n) greet|\bcompany\b/i;

/** Recurring events whose titles vary by more than decoration. Tried in order; `category` limits a rule to one category. */
const SERIES: { category?: CategoryKey; match?: RegExp; series: string | ((title: string) => string) }[] = [
	{ category: 'general_meeting', series: 'General Meeting' },
	{ match: /primary officer/i, series: 'Primary Officer + Dept Meeting' },
	{ category: 'academic', match: /review|exam|final/i, series: (t) => `${courseOf(t)} review` },
	{ match: /open ?house/i, series: 'Open House' },
	{ match: /imagine ?rit/i, series: 'Imagine RIT' },
	{ match: /superb owl/i, series: 'Superb Owl' },
	{ match: /power ?point karaoke/i, series: 'PowerPoint Karaoke' },
	{ match: /(board )?game night/i, series: 'Game Night' },
	{ match: /laser ?tag/i, series: 'Laser Tag' },
	{ match: /table flip/i, series: 'Table Flipping' },
	{ match: /mock (technical )?interview/i, series: 'Mock Interviews' },
	{ match: /r[eé]sum[eé]/i, series: 'Resume Workshop' },
];

/** Stripped from a title to get its series name, in this order. */
const DECORATION: RegExp[] = [
	/\p{Extended_Pictographic}|️/gu, // emoji
	/[╯°□）︵┻━]+/gu, // table-flip art
	/^week \d+\s*[-:]\s*/i, // "Week 3 - General Meeting"
	/^sse\s+(?=[a-z])(?!lab\b)/i, // "SSE Movie Night", but not "SSE Lab ..." or "SSE & SE Picnic"
	/\s*\((finally|cancell?ed|updated)\)/gi,
	/\s*-\s*cancell?ed$/i,
	/[\s!:?.]+$/, // trailing punctuation
	/\s+(#\s*\d+|part \d+|[ivx]+|\d+|v\.?\s*[\d.]+)$/i, // counters: "#2", "Part 1", "III", "v2.0"
];

/** The course a review session is for: "SWEN261" / "SWEN-261" / "261" -> SWEN-261, "CS2" -> CS2, "GCIS 124" -> GCIS-124. */
function courseOf(title: string) {
	const m = title.match(/\b(swen|gcc?is|cs)[\s-]*(\d{3}|\d)?(?!\d)/i);
	if (m) {
		const subject = m[1].toUpperCase().replace('GCCIS', 'GCIS');
		return !m[2] ? subject : m[2].length === 1 ? subject + m[2] : `${subject}-${m[2]}`;
	}
	if (/\b261\b/.test(title)) return 'SWEN-261'; // shortcut: bare course numbers seen so far are all SWEN-261; add others here
	return /physics/i.test(title) ? 'Physics' : 'Other';
}

const undecorated = (title: string) => DECORATION.reduce((t, re) => t.replace(re, ''), title).replace(/\s+/g, ' ').trim() || title;

/** Category and series for an event title. */
export function classifyEvent(rawTitle: string): { category: CategoryKey; series: string } {
	const title = cleanLine(rawTitle) ?? '';
	const company = COMPANIES.find(([re]) => re.test(title))?.[1];
	if (company || COMPANY_CUE.test(title)) return { category: 'company', series: company ?? undecorated(title) };
	const category = CATEGORIES.find((c) => c.match?.test(title))?.key ?? 'other';
	const rule = SERIES.find((r) => (!r.category || r.category === category) && (!r.match || r.match.test(title)));
	const series = !rule ? undecorated(title) : typeof rule.series === 'string' ? rule.series : rule.series(title);
	return { category, series };
}

/** Lowercase letters and digits only, so "PowerPoint Karaoke" and "Power Point Karaoke" group together. */
export const seriesKey = (series: string) => series.toLowerCase().replace(/[^a-z0-9]/g, '');
