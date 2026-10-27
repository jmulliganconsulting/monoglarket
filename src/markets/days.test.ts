import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayText, parseDay } from './days.ts';

test('a real day parses to UTC midnight', () => {
  assert.equal(parseDay('2027-06-01').toISOString(), '2027-06-01T00:00:00.000Z');
});

test('a line that is not a real day parses to an invalid date', () => {
  assert.ok(Number.isNaN(parseDay('not a day').getTime()));
  assert.ok(Number.isNaN(parseDay('2027-02-30').getTime()));
});

test('a day reads as day, short month, year', () => {
  assert.equal(dayText(parseDay('2027-06-01')), '1 Jun 2027');
});
