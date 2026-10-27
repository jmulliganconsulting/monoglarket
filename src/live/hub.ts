// Live prices (vault "Live prices"). Trades never touch this module: they only bump markets.version, which the hub reads.
// So the cost is bounded by the number of watched markets, not by trade volume: one tiny version read per watched market
// per tick, and one snapshot query only for markets whose version moved. Each watcher gets at most one message per tick.
import type { PrismaClient } from '../db/db.ts';
import { prices } from '../engine/lmsr.ts';

export type Snapshot = { id: number; status: string; locked: boolean; outcomes: { id: number; q: number; probability: number }[] };

/** Caps keep a crowd from exhausting the server: over these, the stream is refused and the page keeps its loaded data. */
export const LIMITS = { total: 500, perUser: 4 };
const TICK_MS = 1000;
const HEARTBEAT_MS = 20_000;
export const LIST = 'list';

export class LiveBusy extends Error {
  status: number;
  constructor(status: number) {
    super(status === 429 ? 'Too many live connections from you' : 'Too many live connections right now');
    this.status = status;
  }
}

type Sink = { userId: number; send(event: string, data: string): void };
const watchers = new Map<string, Set<Sink>>();
const versions = new Map<number, number>();
const perUser = new Map<number, number>();
let open = 0;

export async function snapshot(prisma: PrismaClient, id: number): Promise<Snapshot | null> {
  const m = await prisma.market.findUnique({
    where: { id },
    select: { id: true, status: true, lockedAt: true, b: true, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, q: true } } },
  });
  if (!m) return null;
  const qs = m.outcomes.map((o) => o.q.toNumber());
  const p = prices(qs, m.b);
  return { id: m.id, status: m.status, locked: !!m.lockedAt, outcomes: m.outcomes.map((o, i) => ({ id: o.id, q: qs[i], probability: p[i] })) };
}

/** Joins a channel. Throws LiveBusy when the caps are reached. Returns the leave function (safe to call twice). */
export function subscribe(key: string, userId: number, send: (event: string, data: string) => void): () => void {
  if (open >= LIMITS.total) throw new LiveBusy(503);
  if ((perUser.get(userId) ?? 0) >= LIMITS.perUser) throw new LiveBusy(429);
  const sink: Sink = { userId, send };
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key)!.add(sink);
  open++;
  perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  return () => leave(key, sink);
}

function leave(key: string, sink: Sink) {
  const set = watchers.get(key);
  if (!set?.delete(sink)) return;
  if (set.size === 0) watchers.delete(key);
  open--;
  const n = (perUser.get(sink.userId) ?? 1) - 1;
  if (n > 0) perUser.set(sink.userId, n);
  else perUser.delete(sink.userId);
}

function emit(key: string, event: string, data: string) {
  for (const sink of [...(watchers.get(key) ?? [])]) {
    try {
      sink.send(event, data);
    } catch {
      leave(key, sink); // the client has gone; stop writing to it
    }
  }
}

/** One pass: read versions of watched markets, and snapshot only the ones that moved. Bounded work per tick. */
export async function tick(prisma: PrismaClient) {
  const ids = [...watchers.keys()].filter((k) => k !== LIST).map((k) => Number(k.slice(2)));
  const listed = watchers.has(LIST);
  if (ids.length === 0 && !listed) return { moved: 0 };
  // The list channel carries public markets only: hidden and group-only prices reach their viewers on their own page.
  const rows = await prisma.market.findMany({ where: { id: { in: ids } }, select: { id: true, version: true } });
  const publicRows = listed ? await prisma.market.findMany({ where: { status: { in: ['open', 'closed'] }, visibility: 'public', deletedAt: null }, select: { id: true, version: true } }) : [];
  const all = [...rows, ...publicRows.filter((r) => !rows.some((x) => x.id === r.id))];
  const moved = all.filter((r) => versions.get(r.id) !== r.version);
  for (const r of all) versions.set(r.id, r.version);
  const snaps: Snapshot[] = [];
  const movedPublic: Snapshot[] = [];
  for (const r of moved) {
    const s = await snapshot(prisma, r.id);
    if (!s) continue;
    if (rows.some((x) => x.id === r.id)) snaps.push(s);
    if (publicRows.some((x) => x.id === r.id)) movedPublic.push(s);
  }
  for (const s of snaps) emit(`m:${s.id}`, 'snapshot', JSON.stringify(s));
  if (listed && movedPublic.length) emit(LIST, 'snapshots', JSON.stringify(movedPublic));
  return { moved: snaps.length + movedPublic.length };
}

/** Comment-style pings keep proxies from closing idle streams. */
export function heartbeat() {
  for (const set of watchers.values()) for (const sink of [...set]) sink.send('ping', '');
}

export function startHub(prisma: PrismaClient) {
  const tickTimer = setInterval(() => tick(prisma).catch((e) => console.error('Live tick failed:', e.message)), TICK_MS);
  const beat = setInterval(heartbeat, HEARTBEAT_MS);
  return () => {
    clearInterval(tickTimer);
    clearInterval(beat);
  };
}

export const liveStats = () => ({ open, channels: watchers.size });
