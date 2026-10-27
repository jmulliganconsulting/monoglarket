// Live prices hub (vault "Live prices"): caps, one message per change, nothing sent when nothing moved, clean leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../db/db.ts';
import { LIMITS, LiveBusy, subscribe, tick } from './hub.ts';
import { tradeAllowed, TRADES_PER_MINUTE } from '../markets/limits.ts';

// A fake of just the calls the hub makes: market rows with a version, and one market's outcomes.
function fakePrisma(state: { version: number; q: number }) {
  return {
    market: {
      findMany: async () => [{ id: 1, version: state.version }],
      findUnique: async () => ({ id: 1, status: 'open', lockedAt: null, b: 50, outcomes: [{ id: 10, q: { toNumber: () => state.q } }, { id: 11, q: { toNumber: () => 0 } }] }),
    },
  } as unknown as PrismaClient;
}

test('a user has at most a few live connections; leaving frees the slot and is safe to repeat', () => {
  const leaves = [];
  for (let i = 0; i < LIMITS.perUser; i++) leaves.push(subscribe('m:1', 900, () => {}));
  assert.throws(() => subscribe('m:1', 900, () => {}), (e: unknown) => e instanceof LiveBusy && e.status === 429);
  leaves[0]();
  leaves[0](); // second call does nothing
  leaves.push(subscribe('m:1', 900, () => {}));
  for (const l of leaves) l();
});

test('a watcher gets one message when a market moves, and none when it has not', async () => {
  const state = { version: 1, q: 5 };
  const got: string[] = [];
  const leave = subscribe('m:1', 901, (ev) => got.push(ev));
  await tick(fakePrisma(state)); // first pass: the version is new to the hub, so one snapshot
  assert.deepEqual(got, ['snapshot']);
  await tick(fakePrisma(state)); // same version: nothing
  assert.equal(got.length, 1);
  state.version = 2;
  state.q = 9;
  await tick(fakePrisma(state));
  assert.equal(got.length, 2);
  leave();
});

test('a send that fails drops that client and does not stop the others', async () => {
  const state = { version: 5, q: 1 };
  let good = 0;
  const bad = subscribe('m:1', 902, () => {
    throw new Error('closed');
  });
  const leave = subscribe('m:1', 903, () => good++);
  await tick(fakePrisma({ ...state, version: 6 }));
  assert.equal(good, 1);
  bad(); // already dropped by the hub; calling again is harmless
  leave();
});

test('trades are limited to 30 a minute per member', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < TRADES_PER_MINUTE; i++) assert.equal(tradeAllowed(950, t0 + i), true);
  assert.equal(tradeAllowed(950, t0 + 100), false);
  assert.equal(tradeAllowed(950, t0 + 61_000), true); // the window has moved on
});
