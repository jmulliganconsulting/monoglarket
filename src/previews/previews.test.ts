import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewBot, marketSvg, previewPage, wrap } from './previews.ts';
import type { PrismaClient } from '../db/db.ts';

test('signed-in pages get their own title and the site card', async () => {
	const html = await previewPage(null as unknown as PrismaClient, new URL('https://club.example/leaderboard'));
	assert.ok(html.includes('<meta property="og:title" content="Leaderboard · MonoGlarket" />'));
	assert.ok(html.includes('content="https://club.example/og-card.png"'));
});

test('recognises link preview bots and not browsers', () => {
	assert.equal(isPreviewBot('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'), true);
	assert.equal(isPreviewBot('Slackbot-LinkExpanding 1.0'), true);
	assert.equal(isPreviewBot('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15'), false);
	assert.equal(isPreviewBot(null), false);
});

test('wraps words to lines and ends a clipped last line with an ellipsis', () => {
	assert.deepEqual(wrap('Will it rain on Friday', 12, 3), ['Will it rain', 'on Friday']);
	assert.deepEqual(wrap('one two three four five six', 7, 2), ['one two', 'three…']);
});

test('escapes the question and labels in the picture', () => {
	const svg = marketSvg({
		question: 'Is <b>this</b> & "that"?',
		status: 'Open for trading',
		outcomes: [{ label: 'A & B', color: null, probability: 0.6 }, { label: 'C', color: '#123456', probability: 0.4 }],
		series: [
			{ label: 'A & B', points: [{ t: 0, p: 0.5 }, { t: 10, p: 0.6 }] },
			{ label: 'C', points: [{ t: 0, p: 0.5 }, { t: 10, p: 0.4 }] },
		],
		end: 10,
	});
	assert.ok(svg.includes('Is &lt;b&gt;this&lt;/b&gt; &amp; &quot;that&quot;?'));
	assert.ok(svg.includes('A &amp; B'));
	assert.ok(svg.includes('60%'));
});
