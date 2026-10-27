import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLocation, parsePlaces } from './locations.ts';

// Location strings as the SSE site has them -> canonical places ('[meet]' marks a meeting point).
const places = (raw: string, date?: string) => parsePlaces(raw, date ? new Date(date) : null).map((p) => p.place + (p.role === 'meet' ? '[meet]' : ''));

test('the lab, however it is written', () => {
	for (const raw of ['GOL-1670', 'Lab', 'SSE Lab - GOL-1670', 'lab', 'Gol - 1670', 'GOL -1670', 'GOL 1670', 'The lab', 'Tha Lab', 'Lab!', 'Mento Lab', 'SSE LaB', 'sse', 'Society of Saucy Engineers', 'The Lab (GOL-1670)', 'GOL-1670(SSE Lab)', 'GOL 1670, the lab', 'GOL-1670 (Gene Polisseni Center)'])
		assert.deepEqual(places(raw), ['The Lab'], raw);
	assert.deepEqual(parsePlaces('Gol - 1670')[0], { place: 'The Lab', room: 'GOL-1670', role: 'at' });
});

test('meeting in the lab, and several places', () => {
	assert.deepEqual(places('meet at the SSE Lab'), ['The Lab[meet]']);
	assert.deepEqual(places('Meet @ the SSE Lab'), ['The Lab[meet]']);
	assert.deepEqual(places('Altitude Trampoline Park (Meet in SSE Lab)'), ['Altitude Trampoline Park', 'The Lab[meet]']);
	assert.deepEqual(places('SSE & Team Rooms'), ['The Lab', 'Team Rooms']);
	assert.deepEqual(places('SSE Lab / LaserTron'), ['The Lab', 'LaserTron']);
	assert.deepEqual(places('GOL-1670 & GOL-1400'), ['The Lab', 'GOL-1400']);
	assert.deepEqual(places('GOL-1670 OR online'), ['The Lab', 'Online']);
	assert.deepEqual(places('CYB-1710,1720,1730'), ['CYB-1710', 'CYB-1720', 'CYB-1730']);
	assert.deepEqual(places('1520/SSE Lab'), ['GOL-1520', 'The Lab']);
});

test('rooms and venues with more than one name', () => {
	assert.deepEqual(places('USC-1100 Conference Room'), ['USC-1100']);
	assert.deepEqual(places('University Services Center (087USC) - USC-1100 Conference Room'), ['USC-1100']);
	assert.deepEqual(places('GOL-1400 (Large Lecture Hall/Auditorium)'), ['GOL-1400']);
	assert.deepEqual(places('GOL-1400 (Auditorium)'), ['GOL-1400']);
	assert.deepEqual(places('Webb Auditorium (Booth 1350)'), ['Webb Auditorium']);
	assert.deepEqual(places('In the lab! (GOL-1650)'), ['GOL-1650']); // the parenthesis says which room
	for (const raw of ['Atrium', 'GOL Atrium', 'Golisano Atrium']) assert.deepEqual(places(raw), ['Golisano Atrium']);
	assert.deepEqual(places("UPDATED: Steven's Pavilion @ Veterans Memorial Park"), places('Stevens Pavilion'));
});

test('online, empty, unknown', () => {
	for (const raw of ['Online', 'virtual', 'Zoom', 'http://sse.rit.edu/go/dockertalk']) assert.deepEqual(places(raw), ['Online'], raw);
	assert.deepEqual(places(''), []);
	assert.deepEqual(places('TBD (time also TBD)'), []);
	assert.deepEqual(places('Gracies Field        '), ['Gracies Field']);
});

test('the temporary lab during the Spring 2026 renovation', () => {
	assert.deepEqual(places('The (Temporary) Lab'), ['The Temporary Lab']);
	assert.deepEqual(places('GOL-1610', '2026-03-06'), ['The Temporary Lab']);
	assert.deepEqual(places('GOL- 1610', '2019-03-31'), ['GOL-1610']);
	assert.equal(parsePlaces('GOL-1610', new Date('2026-03-06'))[0].room, 'GOL-1610');
});

test('cleanLocation', () => {
	assert.equal(cleanLocation('  Gol - 1670 '), 'GOL-1670');
	assert.equal(cleanLocation('CYB-1710,1720,1730'), 'CYB-1710, 1720, 1730');
	assert.equal(cleanLocation("UPDATED: Steven's Pavilion"), "Steven's Pavilion");
	assert.equal(cleanLocation('   '), null);
});
