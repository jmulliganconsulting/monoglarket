import { error, json } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isHttpsUrl } from '../../../proofs/proofs.ts';
import { subscribeDevice, unsubscribeDevice } from '../../../notifications/push.ts';

// The phone or browser that turns alerts on (POST) or off (DELETE). Signed-in members only (hooks).
export async function POST({ request, locals }) {
	const body = await request.json().catch(() => null);
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : '';
	const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : '';
	if (!isHttpsUrl(endpoint) || !p256dh || !auth || endpoint.length > 2000 || p256dh.length > 200 || auth.length > 100) error(400, 'That device cannot receive alerts.');
	const userAgent = request.headers.get('user-agent')?.slice(0, 200) ?? null;
	await subscribeDevice(prisma, locals.user!.id, { endpoint, p256dh, auth, userAgent });
	return json({ ok: true });
}

export async function DELETE({ request, locals }) {
	const body = await request.json().catch(() => null);
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	if (!endpoint) error(400, 'Which device?');
	await unsubscribeDevice(prisma, locals.user!.id, endpoint);
	return json({ ok: true });
}
