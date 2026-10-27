// SSE event locations: free text in, display text and canonical places out. The same room is written a dozen ways ("GOL-1670",
// "Lab", "Gol - 1670", "Society of Saucy Engineers"), some events list several places, and some meet in the lab first.
// parsePlaces works in three steps:
//   1. split into clauses on separators (/ & ; or ,). A parenthesis inside a phrase is part of it ("The (Temporary) Lab");
//      one at the end of a clause is an aside ("GOL-1400 (Auditorium)", "Altitude Trampoline Park (Meet in SSE Lab)").
//   2. resolve each clause: room codes first (BUILDINGS, NAMED_ROOMS), then known names (ALIASES), else the clause itself.
//   3. combine: asides that only describe are dropped; an aside naming a room replaces a looser name beside it ("In the lab! (GOL-1650)").
// A new place or spelling should only ever need a row in one of the tables below.
import { cleanLine } from './normalize.ts';

export type Place = {
	/** Canonical name: 'The Lab', 'Online', a room code like 'GOL-1400', or the cleaned venue text. */
	place: string;
	/** RIT room code when known, e.g. 'GOL-1670'. */
	room: string | null;
	/** 'at' = where the event happens; 'meet' = where people gather before going to the 'at' place. */
	role: 'at' | 'meet';
};

/** RIT building codes seen in event locations. */
const BUILDINGS = ['GOL', 'CYB', 'USC', 'SHED', 'LBR', 'SAU', 'GAN', 'ENG', 'BOO', 'ORN', 'MSS', 'CBT', 'INS'];
// shortcut: a bare four-digit room ("1520/SSE Lab") is taken to be in Golisano, where nearly every SSE event is.
const DEFAULT_BUILDING = 'GOL';

/** Rooms with a name of their own. from/until (ISO dates) limit a name to the time it applied. */
const NAMED_ROOMS: { room: string; place: string; from?: string; until?: string }[] = [
	{ room: 'GOL-1670', place: 'The Lab' },
	// shortcut: the Spring 2026 renovation as fixed dates; add a row if the lab moves again.
	{ room: 'GOL-1610', place: 'The Temporary Lab', from: '2026-01-01', until: '2026-06-01' },
];

/** Names for places, tried in order on a clause with no room code. First match wins, so put narrower ones first. */
const ALIASES: { match: RegExp; place: string; room?: string }[] = [
	// Whole-clause matches first: a URL like sse.rit.edu/go/x mentions the lab's name but is online.
	{ match: /^(online|virtual|zoom|discord)$|^\w+:\/\//i, place: 'Online' },
	{ match: /\btemp(orary)? lab\b/i, place: 'The Temporary Lab', room: 'GOL-1610' },
	// "Lab" alone means our lab; a different lab would need its own row above this one.
	{ match: /\b(lab|sse|society of saucy engineers)\b/i, place: 'The Lab', room: 'GOL-1670' },
	{ match: /^(golisano |gol )?atrium$/i, place: 'Golisano Atrium' },
	{ match: /^steven'?s pavilion\b/i, place: 'Stevens Pavilion, Veterans Memorial Park' },
];

/** Clauses that don't say where. */
const NOT_A_PLACE = /^(tbd|tba|n\/a)\b/i;
/** Labels some officers put before the place. */
const LABELS = /^(updated|new location|location)\s*:\s*/i;
const MEET = /^meet\s+(?:up\s+)?(?:at|@|in)\s+/i;
const SEPARATORS = /\s*(?:\/|&|;|\bor\b)\s*|,(?!\s*\d{4}\b)\s*/i; // not a comma before more room numbers ("CYB-1710,1720")
const ROOM = new RegExp(`\\b(${BUILDINGS.join('|')})\\s*-?\\s*(\\d{4})((?:\\s*,\\s*\\d{4})*)`, 'gi');

/** Display text: one line, labels dropped, room codes as "GOL-1670" however they were typed. Empty -> null. */
export function cleanLocation(raw: string | null | undefined) {
	const s = cleanLine(raw)
		?.replace(LABELS, '')
		.replace(ROOM, (_, b: string, n: string, more: string) => `${b.toUpperCase()}-${n}${more.replace(/\s*,\s*/g, ', ')}`);
	return s || null;
}

type Clause = { text: string; aside: boolean };

function clauses(text: string): Clause[] {
	if (/^\w+:\/\/\S+$/.test(text)) return [{ text, aside: false }]; // a URL's slashes aren't separators
	const inline = text.replace(/\(([^()]*)\)(?=\s*[\w-])/g, '$1');
	const split = (s: string) => s.split(SEPARATORS).map((t) => t.trim()).filter(Boolean);
	return [
		...split(inline.replace(/\([^()]*\)/g, ' ')).map((t) => ({ text: t, aside: false })),
		...[...inline.matchAll(/\(([^()]*)\)/g)].flatMap((m) => split(m[1]).map((t) => ({ text: t, aside: true }))),
	];
}

function namedRoom(room: string, date: Date | null) {
	const named = NAMED_ROOMS.find((n) => n.room === room && (!n.from || (date && date >= new Date(n.from))) && (!n.until || (date && date < new Date(n.until))));
	return named?.place ?? room;
}

type Found = Omit<Place, 'role'> & { by: 'room' | 'alias' | 'text' };

function resolve(text: string, date: Date | null): Found[] {
	const t = text.replace(/[!.?]+$/, '').trim();
	if (!t || NOT_A_PLACE.test(t)) return [];
	const rooms = [...t.matchAll(ROOM)].flatMap(([, b, n, more]) => [n, ...(more.match(/\d{4}/g) ?? [])].map((x) => `${b.toUpperCase()}-${x}`));
	if (!rooms.length && /^\d{4}$/.test(t)) rooms.push(`${DEFAULT_BUILDING}-${t}`);
	if (rooms.length) return rooms.map((room) => ({ place: namedRoom(room, date), room, by: 'room' }));
	const alias = ALIASES.find((a) => a.match.test(t));
	if (alias) return [{ place: alias.place, room: alias.room ?? null, by: 'alias' }];
	return [{ place: t, room: null, by: 'text' }];
}

/** Canonical places for an event location, in the order written. The date picks date-limited names (the temporary lab). */
export function parsePlaces(raw: string | null | undefined, date: Date | null = null): Place[] {
	const text = cleanLocation(raw);
	if (!text) return [];
	const out: (Place & { by: Found['by']; aside: boolean })[] = [];
	for (const c of clauses(text)) {
		const role = MEET.test(c.text) ? 'meet' : 'at';
		const found = resolve(c.text.replace(MEET, ''), date);
		if (c.aside && role === 'at' && found.every((f) => f.by === 'text')) continue; // description, not a place
		if (c.aside && found.some((f) => f.by === 'room'))
			for (let i = out.length - 1; i >= 0; i--) if (!out[i].aside && out[i].role === role && out[i].by === 'alias') out.splice(i, 1);
		for (const f of found) if (!out.some((o) => o.place === f.place)) out.push({ ...f, role, aside: c.aside });
	}
	return out.map(({ place, room, role }) => ({ place, room, role }));
}
