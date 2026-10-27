import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winningOptions } from './winners.ts';

test('a date question names only the earliest option that held', () => {
  const won = winningOptions([
    { label: 'By 2031', won: true, optionDate: new Date('2031-01-01') },
    { label: 'By 2029', won: true, optionDate: new Date('2029-01-01') },
    { label: 'By 2027', won: false, optionDate: new Date('2027-01-01') },
  ]);
  assert.deepEqual(won.map((o) => o.label), ['By 2029']);
});

test('a several-winner question names every option that won', () => {
  const won = winningOptions([
    { label: 'A', won: true, optionDate: null },
    { label: 'B', won: false, optionDate: null },
    { label: 'C', won: true, optionDate: null },
  ]);
  assert.deepEqual(won.map((o) => o.label), ['A', 'C']);
});

test('nothing won names nobody', () => {
  assert.deepEqual(winningOptions([{ label: 'A', won: false, optionDate: null }]), []);
});
