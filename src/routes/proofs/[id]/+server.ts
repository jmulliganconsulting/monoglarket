import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { canSee, viewerOf } from '../../../markets/visibility.ts';

/**
 * A picture or PDF attached to a resolution proposal (vault "Resolution proof"). Anyone who can see the market can open
 * its proof; nothing else is served from this folder. Pictures show inline; PDFs download.
 */
export async function GET({ params, locals }) {
	const proof = await prisma.resolutionAttachment.findUnique({ where: { id: Number(params.id) }, include: { proposal: { select: { market: true } } } });
	if (!proof || !proof.storedName) error(404, 'No such file');
	if (!canSee(proof.proposal.market, await viewerOf(prisma, locals.user!))) error(404, 'No such file');
	const bytes = await readFile(join(DATA_DIR, 'resolution-proofs', proof.storedName)).catch(() => error(404, 'No such file'));
	const name = (proof.originalName ?? 'proof').replace(/[^\w. -]/g, '_');
	return new Response(bytes, {
		headers: {
			'content-type': proof.mimeType ?? 'application/octet-stream',
			'content-disposition': `${proof.kind === 'image' ? 'inline' : 'attachment'}; filename="${name}"`,
			'cache-control': 'private, max-age=86400',
			'x-content-type-options': 'nosniff',
		},
	});
}
