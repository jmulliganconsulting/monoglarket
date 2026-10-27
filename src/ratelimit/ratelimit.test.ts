// Rate limits (vault ADR-026): fixed windows, headers that show the tightest rule, endpoint rules on top of the site rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest, hit, SITE, type Rule } from './ratelimit.ts';

const rule: Rule = { name: 'test-basic', limit: 3, windowMs: 60_000 };

test('a window allows the limit, then refuses, and resets when it ends', () => {
  const t = 1_000_000; // inside a window
  assert.equal(hit('a', rule, t).allowed, true);
  assert.equal(hit('a', rule, t).allowed, true);
  const third = hit('a', rule, t);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const refused = hit('a', rule, t);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(hit('a', rule, t + 60_000).allowed, true); // a new window
});

test('identities are counted apart, and so are rules', () => {
  const t = 2_000_000;
  for (let i = 0; i < 3; i++) hit('b', rule, t);
  assert.equal(hit('b', rule, t).allowed, false);
  assert.equal(hit('c', rule, t).allowed, true);
  assert.equal(hit('b', { ...rule, name: 'test-other' }, t).allowed, true);
});

test('reset is seconds until the window ends, rounded up', () => {
  const t = 3_000_000 + 10_500; // 10.5 s into a window
  const v = hit('d', rule, t);
  assert.equal(v.resetSeconds, 50);
});

test('checkRequest reports the rule closest to running out', () => {
  const now = 4_000_000;
  // Leaderboard allows 30 a minute, so after 29 requests it is tighter than the 600 site rule.
  let v = checkRequest('e', '/leaderboard', now);
  for (let i = 0; i < 28; i++) v = checkRequest('e', '/leaderboard', now);
  assert.equal(v.limit, 30);
  assert.equal(v.remaining, 1);
  assert.equal(v.allowed, true);
});

test('an endpoint refusal refuses the request even when the site rule allows it', () => {
  const now = 5_000_000;
  for (let i = 0; i < 30; i++) checkRequest('f', '/activity', now);
  const v = checkRequest('f', '/activity', now);
  assert.equal(v.allowed, false);
  assert.equal(v.limit, 30);
});

test('paths with no endpoint rule only get the site rule', () => {
  const v = checkRequest('g', '/markets/1', 6_000_000);
  assert.equal(v.limit, SITE.limit);
  assert.equal(v.remaining, SITE.limit - 1);
});
