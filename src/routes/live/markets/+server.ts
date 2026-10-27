import { prisma } from '#lib/server/db.ts';
import { listSnapshot } from '../../../live/list.ts';
import { LIST } from '../../../live/hub.ts';
import { busyResponse, openStream } from '../../../live/stream.ts';

// Live prices for the open-markets list (the home page). Signed-in members only (hooks).
export async function GET({ locals, request }) {
	const first = JSON.stringify(await listSnapshot(prisma));
	try {
		return openStream(LIST, locals.user!.id, 'snapshots', first, request.signal);
	} catch (e) {
		return busyResponse(e);
	}
}
