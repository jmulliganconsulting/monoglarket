// Trusted external sources for automatic resolution (vault "Resolving markets", ADR-013, NFR-12).
// A maintainer adds an entry to SOURCES for each source, after reviewing its domain. A moderator picks one per market at approval.

/** What a source sees about a market. Outcomes are labels, so the source answers in words and we match them. */
export type ResolverMarket = { id: number; question: string; closeAt: Date | null; outcomes: string[] };

/** 'not_yet' leaves the market alone. 'proposal' names the winning outcome; the evidence is shown to the moderator who confirms it. */
export type ResolverCheck = { status: 'not_yet' } | { status: 'proposal'; outcome: string; evidence: string };

export type ResolverSource = { label: string; check(market: ResolverMarket): Promise<ResolverCheck> };

// Empty until a source is written and its domain approved. Kalshi-style: each entry fetches one named, trusted source.
export const SOURCES: Record<string, ResolverSource> = {};

export const isResolverSource = (key: string) => Object.hasOwn(SOURCES, key);

const MAX_BYTES = 1_000_000;

/** Fetch JSON over HTTPS from an allowlisted host, with a 5 s timeout and a 1 MB cap. Sources must use this. */
export async function fetchJson(url: string, hosts: string[]): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) throw new Error(`host not allowlisted: ${u.hostname}`);
  const res = await fetch(u, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.hostname}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error(`response from ${u.hostname} too large`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`response from ${u.hostname} too large`);
  return JSON.parse(text);
}
