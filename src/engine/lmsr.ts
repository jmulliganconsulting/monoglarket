// Pure LMSR maths. q = shares sold per outcome, b = liquidity.
// Design: vault note "Market mechanics (LMSR)". All exp/log done relative to max(q)/b so large q never overflows.

function shift(q: number[], b: number): number {
  return Math.max(...q) / b;
}

/** C(q) = b * ln(sum exp(q_j / b)) */
export function cost(q: number[], b: number): number {
  const m = shift(q, b);
  let s = 0;
  for (const x of q) s += Math.exp(x / b - m);
  return b * (m + Math.log(s));
}

/** Probability per outcome; sums to 1. */
export function prices(q: number[], b: number): number[] {
  const m = shift(q, b);
  const e = q.map((x) => Math.exp(x / b - m));
  const s = e.reduce((a, x) => a + x, 0);
  return e.map((x) => x / s);
}

/** Dabloons to buy `shares` of outcome i (negative shares = sell, result negative = proceeds). */
export function costToBuy(q: number[], b: number, i: number, shares: number): number {
  const q2 = q.slice();
  q2[i] += shares;
  return cost(q2, b) - cost(q, b);
}

/** Shares of outcome i that `spend` dabloons buys: q_i' = b ln(S e^{X/b} - S + e^{q_i/b}). */
export function sharesForSpend(q: number[], b: number, i: number, spend: number): number {
  const m = shift(q, b);
  let S = 0;
  for (const x of q) S += Math.exp(x / b - m);
  const ei = Math.exp(q[i] / b - m);
  const k = spend / b;
  // ln(S e^k - S + ei) = k + ln(S (1 - e^-k) + ei e^-k), stable for large k
  const qi2 = b * (m + k + Math.log(-S * Math.expm1(-k) + ei * Math.exp(-k)));
  return qi2 - q[i];
}

/** Dabloons received for selling `shares` of outcome i. */
export function proceedsForSell(q: number[], b: number, i: number, shares: number): number {
  return -costToBuy(q, b, i, -shares);
}

/** House's worst-case loss: b * ln(n). */
export function maxLoss(b: number, n: number): number {
  return b * Math.log(n);
}

/** Liquidity for a given subsidy so that maxLoss(b, n) === subsidy. */
export function bForSubsidy(subsidy: number, n: number): number {
  return subsidy / Math.log(n);
}

// Rounding always favours the house (ADR-007). EPS absorbs float noise like 9.9999999999 -> 10.
const EPS = 1e-9;
export const floorShares = (x: number) => Math.floor(x * 1e6 + EPS) / 1e6;
export const floorCoins = (x: number) => Math.floor(x + EPS);
