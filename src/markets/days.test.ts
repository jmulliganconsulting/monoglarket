import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayText } from './days.ts';

test('a day reads as day, short month, year', () => {
  assert.equal(dayText(new Date('2027-06-01T00:00:00Z')), '1 Jun 2027');
});
