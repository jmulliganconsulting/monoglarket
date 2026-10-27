import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent, seriesKey } from './categories.ts';
import { cleanLine } from './normalize.ts';

const kind = (t: string) => Object.values(classifyEvent(t)).join(' / ');

test('general meetings, however they are titled', () => {
	for (const t of ['General Meeting', 'SSE General Meeting', 'Week 3 - General Meeting!', 'General Meeting & Funny Fauna Friday', 'Gen. Meet. W/ SPEECHES', 'First General Meeting!!!'])
		assert.equal(kind(t), 'general_meeting / General Meeting', t);
});

test('company events group by company', () => {
	for (const t of ['WillowTree Tech Talk', 'Willow Tree Talk', 'WillowTree']) assert.equal(kind(t), 'company / WillowTree', t);
	assert.equal(kind('Intuit Ice Cream Social'), 'company / Intuit');
	assert.equal(kind('Datadog Virtual OpenHouse'), 'company / Datadog');
	assert.equal(kind('Austin McChord Visit'), 'company / Austin McChord Visit');
	// A company's career event is a company event, so it can be weighted apart from career development.
	assert.equal(kind('Google Resume review'), 'company / Google');
	assert.equal(kind('Intuit Tech Talk/Workshop'), 'company / Intuit');
	assert.equal(kind('Resume Review with Malachowsky'), 'career / Resume Workshop');
	assert.equal(kind('Career Fair Makeup Talk'), 'career / Career Fair Makeup Talk');
});

test('review sessions group by course', () => {
	assert.equal(kind('SWEN261 Review Session'), 'academic / SWEN-261 review');
	assert.equal(kind('Review SWEN261 Exam 2'), 'academic / SWEN-261 review');
	assert.equal(kind('261 Exam 2 Review Session'), 'academic / SWEN-261 review');
	assert.equal(kind('Review Session CS1 Exam1'), 'academic / CS1 review');
	assert.equal(kind('GCIS 124 Exam Review Session'), 'academic / GCIS-124 review');
	assert.equal(kind('Online Mentoring'), 'academic / Online Mentoring');
});

test('the rest', () => {
	assert.equal(kind('Board Game Night 🎲'), 'social / Game Night');
	assert.equal(kind('Power Point Karaoke'), 'social / PowerPoint Karaoke');
	assert.equal(kind('Sardines III'), 'social / Sardines');
	assert.equal(kind('SSE Bowling! (Finally)'), 'social / Bowling');
	assert.equal(kind('SSE @ ImagineRIT'), 'outreach / Imagine RIT');
	assert.equal(kind('March Open House'), 'outreach / Open House');
	assert.equal(kind('Mock Technical Interviews'), 'career / Mock Interviews');
	assert.equal(kind('Docker Talk'), 'talk / Docker Talk');
	assert.equal(kind('Primary Officer + Dept Meeting'), 'officer / Primary Officer + Dept Meeting');
	assert.equal(kind('Lab Cleaning'), 'lab / Lab Cleaning');
	assert.equal(kind('VOTING OPENS'), 'election / VOTING OPENS');
	assert.equal(kind('PLZ'), 'other / PLZ');
	assert.equal(kind('History Talk - CANCELLED'), 'talk / History Talk');
	assert.equal(kind('Website Series Part 1'), 'project / Website Series');
});

test('cleanLine and seriesKey', () => {
	assert.equal(cleanLine('  Board \n Game\u00a0\u200b  Night '), 'Board Game Night');
	assert.equal(seriesKey('Power Point Karaoke'), seriesKey('PowerPoint Karaoke'));
});
