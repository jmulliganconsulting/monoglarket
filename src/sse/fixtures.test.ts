// Every real title and location the SSE site had (fixtures/events.json) must still classify / parse as recorded.
// When a rule change moves one on purpose, edit its expected value in the fixture; anything else that moves is a regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyEvent } from './categories.ts';
import { parsePlaces } from './locations.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/events.json', import.meta.url), 'utf8')) as {
	titles: Record<string, { category: string; series: string }>;
	locations: { location: string | null; date: string; places: string[] }[];
};

test('every live title keeps its category and series', () => {
	const moved = Object.entries(fixture.titles).filter(([t, want]) => JSON.stringify(classifyEvent(t)) !== JSON.stringify(want)).map(([t, want]) => `${t}: ${JSON.stringify(classifyEvent(t))}, want ${JSON.stringify(want)}`);
	assert.deepEqual(moved, []);
});

test('every live location keeps its places', () => {
	const moved = fixture.locations
		.map(({ location, date, places }) => ({ location, places, got: parsePlaces(location, new Date(date)).map((p) => (p.role === 'meet' ? `${p.place} [meet]` : p.place)) }))
		.filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.places))
		.map((x) => `${x.location}: ${JSON.stringify(x.got)}, want ${JSON.stringify(x.places)}`);
	assert.deepEqual(moved, []);
});
