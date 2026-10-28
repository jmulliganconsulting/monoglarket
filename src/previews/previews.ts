// Link previews (Discord, Slack, Twitter/X, ...). Bots don't sign in, so the hooks answer them with a public page
// of Open Graph tags instead of the login redirect. A public market gets its question, odds and chart as the picture.
import { Resvg } from '@resvg/resvg-js';
import type { PrismaClient } from '../db/db.ts';
import { prices } from '../engine/lmsr.ts';
import { priceSeries } from '../markets/series.ts';

const BOT = /discordbot|slackbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|skypeuripreview|embedly|linkpresentation/i;
export const isPreviewBot = (ua: string | null) => !!ua && BOT.test(ua);

const STATUS: Record<string, string> = {
	pending_review: 'Waiting for approval',
	open: 'Open for trading',
	closed: 'Trading closed',
	resolved: 'Resolved',
	final: 'Final',
	cancelled: 'Cancelled',
};
const COLORS = ['#4f9d69', '#d1495b', '#3e7cb1', '#edae49', '#8e6c8a', '#2ec4b6'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Greedy word wrap; the last line ends in an ellipsis when the text does not fit. */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines[lines.length - 1];
		if (last !== undefined && last.length + 1 + word.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
		else lines.push(word);
	}
	if (lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines);
	kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, perLine - 1).trimEnd()}…`;
	return kept;
}

/** The public facts of a market, or null when it must not be shared (private, hidden, or deleted). */
export async function marketCard(prisma: PrismaClient, id: number) {
	const m = await prisma.market.findUnique({
		where: { id },
		include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' } } },
	});
	if (!m || m.deletedAt || m.visibility !== 'public' || m.status === 'draft' || m.status === 'rejected') return null;
	const trades = await prisma.trade.findMany({ where: { marketId: id }, orderBy: { createdAt: 'asc' }, select: { outcomeId: true, probAfter: true, createdAt: true } });
	const p = prices(m.outcomes.map((o) => o.q.toNumber()), m.b);
	const closed = m.status !== 'open' && m.status !== 'pending_review';
	return {
		question: m.question,
		status: STATUS[m.status] ?? m.status,
		outcomes: m.outcomes.map((o, i) => ({ label: o.label, color: o.color, probability: p[i] })),
		series: priceSeries(m.outcomes, trades, m.createdAt),
		end: closed ? (m.closeAt ?? m.resolvedAt)?.getTime() ?? null : null,
	};
}

type Card = NonNullable<Awaited<ReturnType<typeof marketCard>>>;

/** The picture: question, legend with the odds, and each outcome's chance over time. 1200 x 630, the Open Graph size. */
export function marketSvg(c: Card): string {
	const [x0, y0, w, h] = [60, 330, 700, 220];
	const t0 = Math.min(...c.series.map((s) => s.points[0].t));
	const t1 = c.end ?? Math.max(Date.now(), ...c.series.flatMap((s) => s.points.map((pt) => pt.t)));
	const x = (t: number) => x0 + ((t - t0) / (t1 - t0 || 1)) * w;
	const y = (p: number) => y0 + h - p * h;
	const paths = c.series.map((s, i) => {
		const last = s.points[s.points.length - 1];
		const d = [...s.points, { t: t1, p: last.p }].map((pt, j) => `${j ? 'L' : 'M'}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(' ');
		return `<path d="${d}" fill="none" stroke="${c.outcomes[i].color ?? COLORS[i % COLORS.length]}" stroke-width="5" stroke-linejoin="round"/>`;
	});
	const ranked = c.outcomes.map((o, i) => ({ ...o, color: o.color ?? COLORS[i % COLORS.length] })).sort((a, b) => b.probability - a.probability);
	const shown = ranked.slice(0, 5);
	const legend = shown.map((o, i) => {
		const yy = 370 + i * 56;
		return `<circle cx="812" cy="${yy - 9}" r="10" fill="${o.color}"/><text x="834" y="${yy}" font-size="28" fill="#e8e8e8">${esc(o.label.slice(0, 26))}</text><text x="1140" y="${yy + 2}" font-size="34" font-weight="700" fill="#f5f5f5" text-anchor="end">${pct(o.probability)}</text>`;
	});
	if (ranked.length > shown.length) legend.push(`<text x="834" y="${370 + shown.length * 56}" font-size="24" fill="#9a9a9a">+${ranked.length - shown.length} more</text>`);
	const title = wrap(c.question, 36, 3).map((line, i) => `<text x="60" y="${150 + i * 64}" font-size="52" font-weight="700" fill="#f5f5f5">${esc(line)}</text>`);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Helvetica, Arial, sans-serif">
<rect width="1200" height="630" fill="#111111"/>
<text x="60" y="80" font-size="28" fill="#9a9a9a">MonoGlarket</text>
${title.join('\n')}
${[0.25, 0.5, 0.75].map((g) => `<line x1="${x0}" x2="${x0 + w}" y1="${y(g)}" y2="${y(g)}" stroke="#2a2a2a" stroke-width="2"/>`).join('')}
${paths.join('\n')}
${legend.join('\n')}
<text x="60" y="590" font-size="26" fill="#9a9a9a">${esc(c.status)}</text>
</svg>`;
}

export function renderPng(svg: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
}

function page(meta: { title: string; description: string; url: string; image: string }): string {
	const tags = [
		['og:site_name', 'MonoGlarket'],
		['og:type', 'website'],
		['og:title', meta.title],
		['og:description', meta.description],
		['og:url', meta.url],
		['og:image', meta.image],
		['og:image:width', '1200'],
		['og:image:height', '630'],
	];
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}" />
${tags.map(([k, v]) => `<meta property="${k}" content="${esc(v)}" />`).join('\n')}
<meta name="twitter:card" content="summary_large_image" />
</head>
<body><a href="${esc(meta.url)}">${esc(meta.title)}</a></body>
</html>`;
}

// Titles of the signed-in pages that do not depend on the data (the same as each page's own <title>).
// Pages that show member names or private markets keep the site's card, so nothing is revealed to people who are not signed in.
const TITLES: Record<string, string> = {
	'/portfolio': 'Portfolio',
	'/account': 'Account',
	'/notifications': 'Alerts',
	'/resolve': 'Resolve',
	'/activity': 'Activity',
	'/admin': 'Admin',
	'/leaderboard': 'Leaderboard',
	'/moderate': 'Moderate',
	'/history': 'History',
	'/markets/new': 'New market',
};

/** What a link preview bot reads from a login-gated URL. Markets that are not public show only the site's card. */
export async function previewPage(prisma: PrismaClient, url: URL): Promise<string> {
	const title = TITLES[url.pathname];
	const generic = {
		title: title ? `${title} · MonoGlarket` : 'MonoGlarket',
		description: 'Forecast club events with play-money coins.',
		url: `${url.origin}${url.pathname}`,
		image: `${url.origin}/og-card.png`,
	};
	const match = /^\/markets\/(\d+)\/?$/.exec(url.pathname);
	const card = match ? await marketCard(prisma, Number(match[1])) : null;
	if (!match || !card) return page(generic);
	const odds = card.outcomes.map((o) => `${o.label} ${pct(o.probability)}`).join(' · ');
	return page({
		title: card.question,
		description: `${card.status}. ${odds}`.slice(0, 300),
		url: `${url.origin}/markets/${match[1]}`,
		image: `${url.origin}/share/market-card/${match[1]}`,
	});
}
