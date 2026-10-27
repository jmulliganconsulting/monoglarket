import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, cleanText, gitHubLogin, linkedInSlug, linkedInUrl, nameLooksFake, parseMajors, ritEmail } from './normalize.ts';

test('ritEmail drops the Google g. subdomain only', () => {
	assert.equal(ritEmail('abc1234@g.rit.edu'), 'abc1234@rit.edu');
	assert.equal(ritEmail('abc1234@G.RIT.EDU'), 'abc1234@rit.edu');
	assert.equal(ritEmail('abc1234@rit.edu'), 'abc1234@rit.edu');
	assert.equal(ritEmail('me@gmail.com'), 'me@gmail.com');
});

test('cleanText', () => {
	assert.equal(cleanText('  hi   there \r\n\r\n\r\n\tnext  para '), 'hi there\n\nnext para');
	assert.equal(cleanText('   '), null);
	assert.equal(cleanText(null), null);
});

test('cleanName', () => {
	const cases: [string, string][] = [
		['Draco Del Toro 🦐', 'Draco Del Toro'],
		['José  Núñez', 'Jose Nunez'],
		['toula elwell', 'Toula Elwell'],
		['JOHN GRISCHUK', 'John Grischuk'],
		["mary-jane o'brien", "Mary-Jane O'Brien"],
		['sha8580', 'sha8580'],
		['J G Wentworth', 'J G Wentworth'],
		['A. H. Fernando', 'A. H. Fernando'],
		['DannyCato McCarthy', 'DannyCato McCarthy'],
		['  Ada   Lovelace ', 'Ada Lovelace'],
		['🦐', '🦐'],
	];
	for (const [raw, want] of cases) assert.equal(cleanName(raw), want, raw);
});

test('nameLooksFake', () => {
	for (const n of ['The Ghost of John Renner', 'A', 'Z Z', 'Bob 2', 'Ann Marie Lee Ray Smith']) assert.equal(nameLooksFake(n), true, n);
	for (const n of ['Toula Elwell', 'sha8580', 'J G Wentworth', 'A. H. Fernando', 'Guru Goutham Gangadharappa Ramesha', 'Theo Smith']) assert.equal(nameLooksFake(n), false, n);
});

test('linkedInSlug accepts URLs and slugs, rejects names and jokes', () => {
	const cases: [string | null, string | null][] = [
		['https://www.linkedin.com/in/al627/', 'al627'],
		['linkedin.com/in/jjalangtry', 'jjalangtry'],
		['https://www.linkedin.com/in/elyza-medina-b2a878296?trk=x', 'elyza-medina-b2a878296'],
		['jmulligan191', 'jmulligan191'],
		['kniederhoff ', 'kniederhoff'],
		['bianca-torelli-3055003b8/', 'bianca-torelli-3055003b8'],
		['DannyCato', 'DannyCato'],
		['Taveon Cameron', null],
		['not giving u a linkedin lmao', null],
		['https://github.com/someone', null],
		['', null],
		[null, null],
	];
	for (const [raw, want] of cases) assert.equal(linkedInSlug(raw), want, String(raw));
	assert.equal(linkedInUrl('al627'), 'https://www.linkedin.com/in/al627/');
});

test('gitHubLogin', () => {
	const cases: [string | null, string | null][] = [
		['https://github.com/pybash', 'pybash'],
		['knightingale0 ', 'knightingale0'],
		['https://github.com/garyshadders/garyshadders', 'garyshadders'],
		['@octocat', 'octocat'],
		['', null],
		[null, null],
		['not a username', null],
		['-bad', null],
	];
	for (const [raw, want] of cases) assert.equal(gitHubLogin(raw), want, String(raw));
});

test('parseMajors', () => {
	const m = (raw: string) => parseMajors(raw).map((d) => `${d.major ?? '?' + d.given} ${d.degree}`);
	assert.deepEqual(m('Software Engineering'), ['Software Engineering BS']);
	assert.deepEqual(m(' software engineering '), ['Software Engineering BS']);
	assert.deepEqual(m('Computing and Information Technology'), ['Computing and Information Technologies BS']);
	assert.deepEqual(m('Computer Science/Comp Math'), ['Computer Science BS', 'Computational Mathematics BS']);
	assert.deepEqual(m('Software Engineering BS / CS MS'), ['Software Engineering BS', 'Computer Science MS']);
	assert.deepEqual(m('Software Engineering MS'), ['Software Engineering MS']);
	assert.deepEqual(m('Software Engineering and Computer Engineering'), ['Software Engineering BS', 'Computer Engineering BS']);
	assert.deepEqual(m('Web & Mobile Computing'), ['Web and Mobile Computing BS']);
	assert.deepEqual(m('Computer Engineer'), ['Computer Engineering BS']);
	assert.deepEqual(m('Dual BA in Mathematics and Computer Science, MS in CS, PhD in CS.'), ['?Mathematics BA', 'Computer Science BA', 'Computer Science MS', 'Computer Science PhD']);
	assert.deepEqual(m('Underwater Basket Weaving'), ['?Underwater Basket Weaving BS']);
	assert.deepEqual(m(''), []);
});
