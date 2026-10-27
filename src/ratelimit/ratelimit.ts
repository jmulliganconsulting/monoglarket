// Fixed-window rate limits, kept in memory for one process (vault "Rate limits", ADR-026). Counts reset on restart.

export type Rule = { name: string; limit: number; windowMs: number };
export type Verdict = { allowed: boolean; limit: number; remaining: number; resetSeconds: number };

type Count = { end: number; hits: number };
const counts = new Map<string, Count>();
const SWEEP_AT = 10_000; // drop expired windows once this many are held, so memory stays bounded

export function hit(identity: string, rule: Rule, now = Date.now()): Verdict {
  const key = `${rule.name} ${identity}`;
  let c = counts.get(key);
  if (!c || now >= c.end) {
    if (counts.size >= SWEEP_AT) sweep(now);
    c = { end: Math.floor(now / rule.windowMs) * rule.windowMs + rule.windowMs, hits: 0 };
    counts.set(key, c);
  }
  const allowed = c.hits < rule.limit;
  if (allowed) c.hits++;
  return { allowed, limit: rule.limit, remaining: rule.limit - c.hits, resetSeconds: Math.ceil((c.end - now) / 1000) };
}

function sweep(now: number) {
  for (const [key, c] of counts) if (now >= c.end) counts.delete(key);
}

// Every request is checked against the site-wide rule, plus any endpoint rule for its path.
// shortcut: these numbers are guesses until a week of measurements (ADR-026); upgrade them then.
export const SITE: Rule = { name: 'site', limit: 600, windowMs: 60_000 };
const ENDPOINTS: { prefix: string; rule: Rule }[] = [
  { prefix: '/leaderboard', rule: { name: 'leaderboard', limit: 30, windowMs: 60_000 } },
  { prefix: '/activity', rule: { name: 'activity', limit: 30, windowMs: 60_000 } },
  { prefix: '/live/', rule: { name: 'live', limit: 20, windowMs: 60_000 } },
];

// The verdict that matters to the client is the rule it is closest to using up.
export function checkRequest(identity: string, path: string, now = Date.now()): Verdict {
  const rules = [SITE, ...ENDPOINTS.filter((e) => path.startsWith(e.prefix)).map((e) => e.rule)];
  const verdicts = rules.map((rule) => hit(identity, rule, now));
  const tightest = verdicts.reduce((a, b) => (b.remaining / b.limit < a.remaining / a.limit ? b : a));
  return { ...tightest, allowed: verdicts.every((v) => v.allowed) };
}
