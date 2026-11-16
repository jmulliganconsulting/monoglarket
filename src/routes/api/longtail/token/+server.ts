import { error, json } from '@sveltejs/kit';
import { exchangeCode, secretMatches } from '../../../../longtail/handoff.ts';
import { prisma } from '#lib/server/db.ts';
import { longTail } from '#lib/server/session.ts';

// Long Tail's server swaps a one-time code for the member: POST {"code"} with "Authorization: Bearer <LONGTAIL_SECRET>".
export async function POST({ request }) {
	if (!longTail) error(404, 'Not found');
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ') || !secretMatches(auth.slice(7), longTail)) return json({ error: 'unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const member = typeof body?.code === 'string' ? await exchangeCode(prisma, body.code) : null;
	if (!member) return json({ error: 'invalid_code' }, { status: 400 });
	return json(member);
}
