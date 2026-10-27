// Pure clean-up of the free-text profile fields the SSE site hands us. No I/O; network checks live in resolve.ts.
import { ALIASES, PROGRAMS } from './majors.ts';

/** The SSE site signs in with Google, so emails come back as x@g.rit.edu; the regular address is x@rit.edu. */
export function ritEmail(email: string) {
	return email.replace(/@g\.rit\.edu$/i, '@rit.edu');
}

/** Trim, unify line endings, collapse runs of spaces, keep at most one blank line between paragraphs. Empty -> null. */
export function cleanText(s: string | null | undefined) {
	const out = (s ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width characters pasted in from docs and chats
		.split('\n')
		.map((line) => line.replace(/[^\S\n]+/g, ' ').trim()) // every kind of space, tabs and NBSP included
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return out || null;
}

/** cleanText on one line: newlines become spaces. For titles and locations. Empty -> null. */
export const cleanLine = (s: string | null | undefined) => cleanText(s)?.replace(/\s*\n\s*/g, ' ') ?? null;

// RIT usernames (sha8580): some members never set a name. We can't do better, so they pass through untouched.
const RIT_USERNAME = /^[a-z]{2,4}\d{3,5}$/i;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

/**
 * ASCII only (accents folded first, so José -> Jose; emoji dropped), single spaces, and ALL CAPS / all lowercase
 * names title-cased ("toula elwell" -> "Toula Elwell", "o'brien" -> "O'Brien"). Mixed case is the member's choice
 * and is kept, so initials like "A. H. Fernando" survive. Falls back to the given text if nothing ASCII is left.
 * shortcut: no Mc/Mac/van rules ("mcdonald" -> "Mcdonald"); add them if they show up.
 */
export function cleanName(raw: string) {
	const ascii = raw
		.normalize('NFKD')
		.replace(/[^\x20-\x7e]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!ascii) return raw.trim();
	if (RIT_USERNAME.test(ascii)) return ascii;
	return ascii === ascii.toLowerCase() || ascii === ascii.toUpperCase() ? titleCase(ascii) : ascii;
}

/**
 * Likely joke or placeholder name, for a human to review; never changes the name. Signals: starts with "The",
 * contains "of" ("The Ghost of John Renner"), 5+ words, only single letters ("A", "z z"), or digits that aren't a
 * RIT username. Puns ("al bert") slip through.
 */
export function nameLooksFake(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 1 && RIT_USERNAME.test(words[0])) return false;
	return /^the\s/i.test(name) || words.some((w) => /^of$/i.test(w)) || words.length >= 5 || words.every((w) => w.replace(/\W/g, '').length <= 1) || /\d/.test(name);
}

const LINKEDIN_URL = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)\/?(?:[?#].*)?$/i;
const LINKEDIN_SLUG = /^[\p{L}\p{N}-]{3,100}$/u; // LinkedIn custom URLs: 3-100 letters, digits, hyphens

/**
 * Profile slug (the part after /in/) from a full URL, partial URL or bare slug; null for names, jokes and blanks.
 * shortcut: shape check only (LinkedIn has no public lookup), so a slug-shaped joke like "idk" passes; a LinkedIn sign-in verifies it later.
 */
export function linkedInSlug(raw: string | null | undefined) {
	const s = raw?.trim();
	if (!s || /\s/.test(s)) return null;
	let slug = s.match(LINKEDIN_URL)?.[1] ?? s.replace(/\/$/, '');
	try {
		slug = decodeURIComponent(slug);
	} catch {
		return null;
	}
	return LINKEDIN_SLUG.test(slug) ? slug : null;
}

export const linkedInUrl = (slug: string) => `https://www.linkedin.com/in/${slug}/`;

const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** GitHub username from a profile URL, a repo URL (owner wins) or a bare/@ username; null if it can't be one. */
export function gitHubLogin(raw: string | null | undefined) {
	const s = raw?.trim();
	if (!s) return null;
	const login = s.match(GITHUB_URL)?.[1] ?? s.replace(/^@/, '');
	return GITHUB_LOGIN.test(login) ? login : null;
}

export type Degree = { degree: string; major: string | null; given: string };

// Degree abbreviations, case-sensitive so the word "as" or "ma" isn't read as a degree.
const DEGREE = /\b(B\.?S|B\.?A|B\.?F\.?A|B\.?B\.?A|M\.?S|M\.?A|M\.?Eng|MBA|MFA|MST|M\.?Arch|Ph\.?D|OTD|AAS|AOS)\b\.?/g;
const FILLER = /\b(dual|degree|degrees|major|in|of)\b/gi;

const majorKey = (s: string) =>
	s
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/\(.*?\)/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const byKey = new Map<string, string>();
const degreesOf = new Map<string, string[]>();
for (const [name, degree] of PROGRAMS) {
	byKey.set(majorKey(name), name);
	degreesOf.set(name, [...(degreesOf.get(name) ?? []), degree]);
}
for (const [alias, name] of Object.entries(ALIASES)) byKey.set(majorKey(alias), name);

const lookup = (s: string) => byKey.get(majorKey(s)) ?? null;
// No degree written: BS if RIT offers it, else the program's first listed degree, else BS.
const defaultDegree = (major: string | null) => (major && !degreesOf.get(major)?.includes('BS') && degreesOf.get(major)?.[0]) || 'BS';

/** One chunk like "CS MS" or "Dual BA in Mathematics and Computer Science" -> its degrees. */
function parseChunk(chunk: string): Degree[] | null {
	const given = chunk.trim().replace(/\.$/, '');
	const degree = [...given.matchAll(DEGREE)].map((m) => m[1].replace(/\./g, '')).at(-1);
	const name = given.replace(DEGREE, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
	if (!name) return null;
	const whole = lookup(name);
	if (whole) return [{ degree: degree ?? defaultDegree(whole), major: whole, given }];
	// "Software Engineering and Computer Engineering": split only if that finds at least one real program.
	const parts = name.split(/\s+and\s+/i).map((p) => ({ p, major: lookup(p) }));
	if (parts.length > 1 && parts.some((x) => x.major)) return parts.map(({ p, major }) => ({ degree: degree ?? defaultDegree(major), major, given: p }));
	return null;
}

/**
 * Free-text major -> one row per degree. Splits on / ; | + first, then commas; unmatched text is kept with major = null.
 * "Software Engineering BS / CS MS" -> [SE BS, CS MS]; "Computer Science/Comp Math" -> [CS BS, Computational Mathematics BS].
 */
export function parseMajors(raw: string | null | undefined): Degree[] {
	const text = cleanText(raw)?.replace(/\s+/g, ' ');
	if (!text) return [];
	const out: Degree[] = [];
	for (const piece of text.split(/\s*[\/;|+]\s*/).filter(Boolean)) {
		const found = parseChunk(piece) ?? piece.split(/\s*,\s*/).filter(Boolean).flatMap((c) => parseChunk(c) ?? [{ degree: defaultDegree(null), major: null, given: c.trim().replace(/\.$/, '') }]);
		out.push(...found);
	}
	const seen = new Set<string>();
	return out.filter((d) => {
		const k = `${d.major ?? d.given}|${d.degree}`;
		return !seen.has(k) && seen.add(k);
	});
}
