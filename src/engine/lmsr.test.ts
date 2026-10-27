import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bForSubsidy, cost, costToBuy, maxLoss, prices, proceedsForSell, sharesForSpend } from './lmsr.ts';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('worked example from the design doc', () => {
  const shares = sharesForSpend([0, 0], 100, 0, 10);
  close(shares, 19.0899, 1e-3);
  close(prices([shares, 0], 100)[0], 0.5476, 1e-4);
  close(costToBuy([0, 0], 100, 0, shares), 10);
});

test('prices sum to 1 and stay in (0,1), even for huge q', () => {
  for (const q of [[0, 0], [50, -20, 3], [1e6, 0], [0, 0, 0, 0, 0]]) {
    const p = prices(q, 50);
    close(p.reduce((a, x) => a + x, 0), 1);
    for (const x of p) assert.ok(x >= 0 && x <= 1 && Number.isFinite(x));
  }
});

test('sharesForSpend inverts costToBuy, including large spends', () => {
  for (const [q, b, i, spend] of [[[0, 0], 100, 1, 37], [[30, 5, -2], 40, 2, 250], [[0, 0], 10, 0, 100_000]] as const) {
    const s = sharesForSpend([...q], b, i, spend);
    assert.ok(Number.isFinite(s));
    close(costToBuy([...q], b, i, s), spend, 1e-6 * Math.max(1, spend));
  }
});

test('buy then sell returns the spend', () => {
  const q = [12, 3];
  const s = sharesForSpend(q, 80, 0, 25);
  close(proceedsForSell([q[0] + s, q[1]], 80, 0, s), 25);
});

test('house never loses more than b ln n over random trades', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const n of [2, 3, 6]) {
    const b = bForSubsidy(100, n);
    const q = new Array(n).fill(0);
    for (let t = 0; t < 500; t++) {
      const i = Math.floor(rand() * n);
      if (rand() < 0.7 || q[i] <= 0) q[i] += sharesForSpend(q, b, i, 1 + rand() * 50);
      else q[i] -= rand() * q[i];
    }
    // collected = C(q) - C(0); worst payout = max(q)
    const collected = cost(q, b) - cost(new Array(n).fill(0), b);
    assert.ok(Math.max(...q) - collected <= maxLoss(b, n) + 1e-6);
    close(maxLoss(b, n), 100);
  }
});
