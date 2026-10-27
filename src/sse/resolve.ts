// Network lookups that back the SSE mirror: GitHub users, RIT term numbers, and local copies of profile pictures.
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';

export type Fetch = typeof fetch;

/** GitHub's own spelling of a username plus its permanent numeric id; null = no such user. Throws on rate limits/outages. */
export async function resolveGitHub(login: string, opts: { token?: string; fetchFn?: Fetch } = {}) {
	const res = await (opts.fetchFn ?? fetch)(`https://api.github.com/users/${encodeURIComponent(login)}`, {
		headers: { accept: 'application/vnd.github+json', 'user-agent': 'club-predictions-sse-sync', ...(opts.token && { authorization: `Bearer ${opts.token}` }) },
		signal: AbortSignal.timeout(15_000),
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GitHub ${login}: HTTP ${res.status}`);
	const u = await res.json();
	return { login: String(u.login), id: Number(u.id) };
}

const SEASON = { FALL: 'Fall', SPRING: 'Spring', SUMMER: 'Summer' } as const;

/** "Spring 2026" -> "2255", every page of api.rit.edu/api/terms. */
export async function fetchRitTerms(apiKey: string, fetchFn: Fetch = fetch) {
	const codes = new Map<string, string>();
	for (let url: string | null = 'https://api.rit.edu/api/terms'; url; ) {
		const res = await fetchFn(url, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`RIT terms: HTTP ${res.status}`);
		const page: { data: { code: string; name: string }[]; next_page_url: string | null } = await res.json();
		for (const t of page.data) codes.set(t.name, t.code);
		url = page.next_page_url;
	}
	return codes;
}

/**
 * RIT term number for a graduation term. The API only lists a few years around now, so terms it lacks use RIT's
 * semester code pattern (2 + academic year's last two digits + 1 Fall / 5 Spring / 8 Summer; matches every API row).
 * Pre-semester terms (before Fall 2013) used a different scheme: null.
 */
export function ritTermCode(codes: Map<string, string>, term: string | null, year: number | null) {
	const season = SEASON[term as keyof typeof SEASON];
	if (!season || !year) return null;
	const academicYear = season === 'Fall' ? year : year - 1;
	return codes.get(`${season} ${year}`) ?? (academicYear >= 2013 ? String(2000 + (academicYear % 100) * 10 + { Fall: 1, Spring: 5, Summer: 8 }[season]) : null);
}

// Profile picture URLs are typed by users, so never let them reach our own network (Postgres, cloud metadata, ...).
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

export type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

async function assertPublic(url: URL, lookup: Lookup) {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`unsupported scheme ${url.protocol}`);
	const host = url.hostname.replace(/^\[|\]$/g, '');
	for (let ip of isIP(host) ? [host] : await lookup(host)) {
		ip = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
		if (PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')) throw new Error(`${host} resolves to a private address`);
	}
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }; // no SVG: it can carry script
export const IMAGE_FILE = /^[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Download a profile picture into dir as <sha256>.<ext> and return that file name. Relative URLs (the SSE site's
 * /api/aws/image?key=...) resolve against the SSE origin. Sends a browser User-Agent because Discord and some hosts refuse bots.
 * shortcut: DNS is checked before each hop, not pinned for the connection (rebinding gap); fine for a background job.
 */
export async function saveImage(given: string, opts: { baseUrl: string; dir: string; fetchFn?: Fetch; lookup?: Lookup }) {
	const fetchFn = opts.fetchFn ?? fetch;
	let url = new URL(given.trim(), opts.baseUrl);
	let res: Response | undefined;
	for (let hop = 0; hop <= 3; hop++) {
		await assertPublic(url, opts.lookup ?? systemLookup);
		res = await fetchFn(url, {
			redirect: 'manual',
			headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
			signal: AbortSignal.timeout(20_000),
		});
		const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
		if (!next) break;
		url = new URL(next, url);
		res = undefined;
	}
	if (!res) throw new Error('too many redirects');
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const ext = EXT[(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()];
	if (!ext) throw new Error(`not a supported image (${res.headers.get('content-type')})`);

	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		size += chunk.byteLength;
		if (size > MAX_BYTES) throw new Error('image larger than 10 MB');
		chunks.push(chunk);
	}
	if (size === 0) throw new Error('empty image');
	const bytes = Buffer.concat(chunks);
	const file = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
	await mkdir(opts.dir, { recursive: true });
	if (!existsSync(join(opts.dir, file))) await writeFile(join(opts.dir, file), bytes);
	return file;
}
