import { json } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';

/** Liveness + database reachability, for Docker and uptime checks. */
export async function GET() {
	try {
		await prisma.currency.count();
		return json({ ok: true });
	} catch {
		return json({ ok: false, error: 'database unreachable' }, { status: 503 });
	}
}
