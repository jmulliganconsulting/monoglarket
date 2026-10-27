import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHeadliner } from './headliner.ts';

const markets = [
	{ id: 1, headliner: false },
	{ id: 2, headliner: false },
	{ id: 3, headliner: false },
];

test('the most traded market is the headliner by default', () => {
	assert.equal(pickHeadliner(markets, new Map([[2, 5], [3, 1]])), 2);
});

test('a tie in trades goes to the one closing first', () => {
	assert.equal(pickHeadliner(markets, new Map([[2, 4], [3, 4]])), 2);
	assert.equal(pickHeadliner(markets, new Map()), 1);
});

test('a moderator pick wins over activity', () => {
	const picked = markets.map((m) => ({ ...m, headliner: m.id === 1 }));
	assert.equal(pickHeadliner(picked, new Map([[3, 99]])), 1);
});

test('no markets, no headliner', () => {
	assert.equal(pickHeadliner([], new Map()), null);
});
