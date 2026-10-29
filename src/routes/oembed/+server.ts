import { error, json } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { marketCard } from '../../previews/previews.ts';

/** oEmbed (oembed.com): a sites-embed card for a public market, the same facts a link preview shows. Anyone can ask, so only public markets answer. */
export async function GET({ url }) {
	if ((url.searchParams.get('format') ?? 'json') !== 'json') error(501, 'Only format=json is supported');
	let target: URL;
	try {
		target = new URL(url.searchParams.get('url') ?? '');
	} catch {
		error(400, 'url must be a full link to a market on this site');
	}
	const match = target.origin === url.origin ? /^\/markets\/(\d+)\/?$/.exec(target.pathname) : null;
	if (!match) error(404, 'Not a market on this site');
	const id = Number(match[1]);
	const card = await marketCard(prisma, id);
	if (!card) error(404, 'Not a public market');
	return json(
		{
			version: '1.0',
			type: 'link',
			title: card.question,
			provider_name: 'Monoglarket',
			provider_url: url.origin,
			thumbnail_url: `${url.origin}/share/market-card/${id}`,
			thumbnail_width: 1200,
			thumbnail_height: 630,
		},
		{ headers: { 'cache-control': 'public, max-age=300' } },
	);
}
