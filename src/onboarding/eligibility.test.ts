import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageGate, todayInNewYork } from './eligibility.ts';

const today = { year: 2026, month: 10, day: 26 };

test('birth year decides everyone except 18-year-olds', () => {
  assert.equal(ageGate({ year: 2000 }, today), 'adult'); // 26
  assert.equal(ageGate({ year: 2007 }, today), 'adult'); // 19: at least 18 whatever the birthday
  assert.equal(ageGate({ year: 2009 }, today), 'minor'); // 17
  assert.equal(ageGate({ year: 2010 }, today), 'minor');
});

test('exactly 18 needs a month and day, then the birthday decides', () => {
  assert.equal(ageGate({ year: 2008 }, today), 'ask');
  assert.equal(ageGate({ year: 2008, month: 3, day: 1 }, today), 'adult'); // birthday passed this year
  assert.equal(ageGate({ year: 2008, month: 10, day: 26 }, today), 'adult'); // today is the birthday
  assert.equal(ageGate({ year: 2008, month: 12, day: 1 }, today), 'minor'); // still 17
});

test('today is read in New York, not UTC', () => {
  // 02:00 UTC on 27 Oct is still 26 Oct in New York (EDT, UTC-4)
  assert.deepEqual(todayInNewYork(new Date('2026-10-27T02:00:00Z')), { year: 2026, month: 10, day: 26 });
  assert.deepEqual(todayInNewYork(new Date('2026-10-27T05:00:00Z')), { year: 2026, month: 10, day: 27 });
});
