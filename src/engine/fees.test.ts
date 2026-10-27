// The early-sale fee (vault ADR-021): rounded up in the house's favour, and the member keeps the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netOfFee, sellFee, SELL_FEE } from './fees.ts';

test('the fee is SELL_FEE of the gross, rounded up to a whole dabloon', () => {
  assert.equal(SELL_FEE, 0.05);
  assert.equal(sellFee(0), 0);
  assert.equal(sellFee(100), 5);
  assert.equal(sellFee(19), 1); // 0.95 rounds up to 1
  assert.equal(sellFee(20), 1);
  assert.equal(sellFee(21), 2); // 1.05 rounds up to 2
});

test('the member keeps the gross minus the fee, and the two always add back up', () => {
  for (let gross = 0; gross <= 500; gross++) {
    assert.equal(netOfFee(gross) + sellFee(gross), gross);
    assert.ok(netOfFee(gross) <= gross * (1 - SELL_FEE) + 1e-9);
  }
});
