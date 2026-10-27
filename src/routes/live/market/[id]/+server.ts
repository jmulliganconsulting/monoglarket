import { error } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { snapshot } from '../../../../live/hub.ts';
import { canSee, viewerOf } from '../../../../markets/visibility.ts';
import { busyResponse, openStream } from '../../../../live/stream.ts';

// Live prices for one market. Signed-in members only (hooks).
export async function GET({ params, locals, request }) {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404);
	const m = await prisma.market.findUnique({ where: { id }, select: { visibility: true, groupId: true, deletedAt: true } });
	if (!m || !canSee(m, await viewerOf(prisma, locals.user!))) error(404);
	const first = await snapshot(prisma, id);
	if (!first) error(404);
	try {
		return openStream(`m:${id}`, locals.user!.id, 'snapshot', JSON.stringify(first), request.signal);
	} catch (e) {
		return busyResponse(e);
	}
}
