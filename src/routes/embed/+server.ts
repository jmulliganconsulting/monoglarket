import { error, json } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { componentEmbed, previewMeta } from '../../previews/previews.ts';

/** Discord component embed for a page on this site (linked from the page's <head>). Uses the same card as link previews, so nothing private is shown. */
export async function GET({ url }) {
	let target: URL;
	try {
		target = new URL(url.searchParams.get('url') ?? '');
	} catch {
		error(400, 'url must be a full link to a page on this site');
	}
	if (target.origin !== url.origin) error(404, 'Not a page on this site');
	return json(componentEmbed(await previewMeta(prisma, target)), { headers: { 'cache-control': 'public, max-age=300' } });
}
