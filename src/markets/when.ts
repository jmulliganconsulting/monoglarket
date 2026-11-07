// Date questions: each option is a span of time, written the way people say it ("Before 11/15", "Sunday at 3pm", "11/2",
// "After 11/3", "Sat 9am-5pm") and worked out in the creator's time zone. Stored as instants, so it settles the same anywhere.

/** lo is when the span starts (inclusive), hi when it ends (exclusive), in ms; null = open. time: it names a clock time
 * (else whole days, in tz). date: it names a day (else today). */
export type When = { lo: number | null; hi: number | null; tz: string; time: boolean; date: boolean };

const MIN = 60_000;

export const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The browser's (or server's) own time zone. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Day = { y: number; m: number; d: number };

/** The calendar day and clock `at` shows in `tz`. */
function wall(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, min: p.hour * 60 + p.minute };
}

/** The instant a day and clock time in `tz` happens. In a daylight-saving gap or overlap, the first reading. */
export function zoned(day: Day, min: number, tz: string) {
  const guess = Date.UTC(day.y, day.m - 1, day.d, 0, min);
  const offset = (t: number) => {
    const w = wall(t, tz);
    return Date.UTC(w.y, w.m - 1, w.d, 0, w.min) - Math.floor(t / MIN) * MIN;
  };
  return guess - offset(guess - offset(guess));
}

const addDays = (day: Day, n: number): Day => {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const real = (day: Day) => {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d));
  return t.getUTCFullYear() === day.y && t.getUTCMonth() === day.m - 1 && t.getUTCDate() === day.d;
};
const before = (a: Day, b: Day) => Date.UTC(a.y, a.m - 1, a.d) < Date.UTC(b.y, b.m - 1, b.d);

const WEEKDAYS = [/^sun(day)?$/, /^mon(day)?$/, /^tue(s|sday)?$/, /^wed(s|nesday)?$/, /^thu(r|rs|rsday)?$/, /^fri(day)?$/, /^sat(urday)?$/];
const TOKEN = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2}|[a-z]+|<=|>=|[<>≤≥+–-]/g;
const FILLER = new Set(['at', 'on', 'the', 'of', 'this']);
const SEPARATORS = new Set(['-', '–', 'to', 'through', 'thru', 'and']);
type Kind = 'before' | 'by' | 'after' | 'from' | 'between';
const PREFIXES: [string, Kind][] = [
  ['on or before', 'by'], ['no later than', 'by'], ['on or after', 'from'], ['no earlier than', 'from'], ['between', 'between'],
  ['before', 'before'], ['until', 'before'], ['<', 'before'], ['by', 'by'], ['<=', 'by'], ['≤', 'by'],
  ['after', 'after'], ['>', 'after'], ['from', 'from'], ['since', 'from'], ['>=', 'from'], ['≥', 'from'],
];

/** A day and/or a clock time from its tokens. Day: as written, else the next such day from today (a weekday, or a month/day
 * with no year); null if none named. Null overall if a token isn't one. */
function point(tokens: string[], today: Day): { day: Day | null; min: number | null } | null {
  let day: Day | null = null;
  let min: number | null = null;
  for (const t of tokens) {
    let m: RegExpMatchArray | null;
    let d: Day | null = null;
    let clock: number | null = null;
    if (FILLER.has(t)) continue;
    if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) d = { y: +m[1], m: +m[2], d: +m[3] };
    else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d+))?$/))) {
      d = { y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.y, m: +m[1], d: +m[2] };
      if (!m[3] && real(d) && before(d, today)) d = { ...d, y: d.y + 1 };
    } else if (t === 'today' || t === 'tonight') d = today;
    else if (t === 'tomorrow') d = addDays(today, 1);
    else if (WEEKDAYS.some((w) => w.test(t))) {
      const want = WEEKDAYS.findIndex((w) => w.test(t));
      const now = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
      d = addDays(today, (want - now + 7) % 7);
    } else if (t === 'noon') clock = 12 * 60;
    else if ((m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/))) {
      if (+m[1] < 1 || +m[1] > 12 || +(m[2] ?? 0) > 59) return null;
      clock = ((+m[1] % 12) + (m[3] === 'p' ? 12 : 0)) * 60 + +(m[2] ?? 0);
    } else if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) {
      if (+m[1] > 23 || +m[2] > 59) return null;
      clock = +m[1] * 60 + +m[2];
    } else return null;
    if (d) {
      if (day || !real(d)) return null;
      day = d;
    }
    if (clock !== null) {
      if (min !== null) return null;
      min = clock;
    }
  }
  return day || min !== null ? { day, min } : null;
}

/** Parse an option as written, in time zone `tz`, as of `now`. Null if it isn't one. */
export function parseWhen(text: string, tz: string, now = Date.now()): When | null {
  if (!validZone(tz)) return null;
  const s = text.toLowerCase().trim();
  const tokens: string[] = [...(s.match(TOKEN) ?? [])];
  if (s.replace(TOKEN, '').replace(/[\s,.]/g, '') !== '') return null;
  const w = wall(now, tz);
  const today = { y: w.y, m: w.m, d: w.d };

  let kind: Kind | null = null;
  const joined = tokens.join(' ');
  const prefix = PREFIXES.find(([p]) => joined === p || joined.startsWith(p + ' '));
  let rest = tokens;
  if (prefix) {
    kind = prefix[1];
    rest = tokens.slice(prefix[0].split(' ').length);
  } else if (tokens.at(-1) === '+') {
    kind = 'from';
    rest = tokens.slice(0, -1);
  }
  const cut = rest.findIndex((t) => SEPARATORS.has(t));
  const parts = cut < 0 ? [rest] : [rest.slice(0, cut), rest.slice(cut + 1)];
  // A span ("11/15-11/20") takes no prefix but "from" or "between"; "between" needs a span.
  if ((kind === 'between' && cut < 0) || (cut >= 0 && kind !== null && kind !== 'from' && kind !== 'between')) return null;
  const points = parts.map((p) => point(p, today));
  if (points.some((p) => !p)) return null;
  // "Sat 9am-5pm": a time with no day takes the other end's day, else today.
  const named = points.find((p) => p!.day)?.day ?? null;
  const spans = points.map((p) => {
    const day = p!.day ?? named ?? today;
    return p!.min === null ? { start: zoned(day, 0, tz), end: zoned(addDays(day, 1), 0, tz) } : { start: zoned(day, p!.min, tz), end: zoned(day, p!.min, tz) };
  });
  const time = points.some((p) => p!.min !== null);
  const at = { tz, time, date: !!named };

  let lo: number | null = null;
  let hi: number | null = null;
  if (points.length === 2) [lo, hi] = [spans[0].start, spans[1].end];
  else if (kind === 'before') hi = spans[0].start;
  else if (kind === 'by') hi = spans[0].end;
  else if (kind === 'after') lo = spans[0].end;
  else if (kind === 'from') lo = spans[0].start;
  // A bare day is that day; a bare time can only be a deadline ("by 3pm").
  else if (time) hi = spans[0].start;
  else [lo, hi] = [spans[0].start, spans[0].end];
  if (lo !== null && hi !== null && lo >= hi) return null;
  return { lo, hi, ...at };
}

export const whenHolds = (w: When, at: Date) => (w.lo === null || at.getTime() >= w.lo) && (w.hi === null || at.getTime() < w.hi);

export const readWhen = (s: string | null): When | null => {
  try {
    const w = s ? JSON.parse(s) : null;
    return w && typeof w === 'object' && 'tz' in w ? w : null;
  } catch {
    return null;
  }
};

/** The instant to sort and name winners by: the span's end, else its start. */
export const whenEdge = (w: When) => (w.hi ?? w.lo)!;

/**
 * How an option reads in time zone `tz`. Times: "Before 3:00 PM EST", "Sun, Nov 8, 9:00 AM EST – 5:00 PM EST" (the day is shown
 * when the option named one, or when it falls on another day than in the creator's zone). Whole days read in the creator's zone,
 * as their days: "By Sat, Oct 31", "From Wed, Nov 4", "On Mon, Nov 2".
 */
export function describeWhen(w: When, tz = localZone()) {
  const days = (t: number, zone: string): Intl.DateTimeFormatOptions => ({ weekday: 'short', month: 'short', day: 'numeric', ...(wall(t, zone).y === wall(Date.now(), zone).y ? {} : { year: 'numeric' }) });
  if (!w.time) {
    const day = (t: number) => new Intl.DateTimeFormat('en-US', { timeZone: w.tz, ...days(t, w.tz) }).format(t);
    if (w.lo === null) return `By ${day(w.hi! - MIN)}`;
    if (w.hi === null) return `From ${day(w.lo)}`;
    return day(w.lo) === day(w.hi - MIN) ? `On ${day(w.lo)}` : `${day(w.lo)} – ${day(w.hi - MIN)}`;
  }
  const otherDay = (t: number) => {
    const a = wall(t, tz);
    const b = wall(t, w.tz);
    return a.d !== b.d;
  };
  const at = (t: number, day = w.date || otherDay(t)) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, ...(day ? days(t, tz) : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(t);
  if (w.lo === null) return `Before ${at(w.hi!)}`;
  if (w.hi === null) return `After ${at(w.lo)}`;
  const sameDay = wall(w.lo, tz).d === wall(w.hi, tz).d && w.hi - w.lo < 86_400_000;
  return `${at(w.lo)} – ${at(w.hi, !sameDay && (w.date || otherDay(w.hi)))}`;
}

/** A date ("2026-11-06") or date-time ("2026-11-06T15:00") input's value, read in `tz`, as an instant. NaN if it isn't one. */
export function fromInput(value: string, tz: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  return m && validZone(tz) ? zoned({ y: +m[1], m: +m[2], d: +m[3] }, +(m[4] ?? 0) * 60 + +(m[5] ?? 0), tz) : NaN;
}

/** The cookie the browser keeps its own time zone in, so pages can show option times in the viewer's zone. */
export const ZONE_COOKIE = 'tz';

/** An option's label for a viewer in `tz`: a time is re-read in their zone; anything else (or no known zone) as stored. */
export const optionLabelIn = (label: string | null, range: string | null, tz: string | undefined) => {
  const w = readWhen(range);
  return label !== null && w?.time && tz && validZone(tz) ? describeWhen(w, tz) : label;
};

/** The time zones to offer in a picker: UTC first, then every one the runtime knows. */
export const zones = () => ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];
