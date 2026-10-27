import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOn } from './colour.ts';

test('dark text on light colours, white text on dark ones', () => {
	assert.equal(textOn('#ffffff'), '#111');
	assert.equal(textOn('#ffe066'), '#111');
	assert.equal(textOn('#000000'), '#fff');
	assert.equal(textOn('#1d4ed8'), '#fff');
});
