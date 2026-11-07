import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winningOptions } from './winners.ts';

test('a date question names every option that held, overlapping or not', () => {
  const won = winningOptions([
    { label: 'Before Nov 15', won: true },
    { label: 'On Nov 14', won: true },
    { label: 'After Nov 15', won: false },
  ]);
  assert.deepEqual(won.map((o) => o.label), ['Before Nov 15', 'On Nov 14']);
});

test('a several-winner question names every option that won', () => {
  const won = winningOptions([
    { label: 'A', won: true },
    { label: 'B', won: false },
    { label: 'C', won: true },
  ]);
  assert.deepEqual(won.map((o) => o.label), ['A', 'C']);
});

test('nothing won names nobody', () => {
  assert.deepEqual(winningOptions([{ label: 'A', won: false }]), []);
});
