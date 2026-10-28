import { error } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { marketCard, marketSvg, renderPng } from '../../../../previews/previews.ts';

/** The picture a link preview shows for a public market. Anyone can fetch it, so only public markets render. */
export async function GET({ params }) {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404);
	const card = await marketCard(prisma, id);
	if (!card) error(404);
	return new Response(renderPng(marketSvg(card)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' } });
}
