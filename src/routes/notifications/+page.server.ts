import { prisma } from '#lib/server/db.ts';
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } from '$app/env/private';

// In-app alerts (FR-20): held markets resolving, closing or disputed, and moderator reminders (FR-24).
// Web push (FR-20) is offered here too, when the server has VAPID keys.
export async function load({ locals }) {
	const userId = locals.user!.id;
	const [items, me] = await Promise.all([
		prisma.notification.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
			take: 50,
			select: { id: true, kind: true, text: true, marketId: true, createdAt: true, readAt: true },
		}),
		prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pushAlerts: true } }),
	]);
	const pushReady = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
	return { items, pushReady, vapidPublicKey: pushReady ? VAPID_PUBLIC_KEY : null, pushAlerts: me.pushAlerts };
}

export const actions = {
	markAllRead: async ({ locals }) => {
		await prisma.notification.updateMany({ where: { userId: locals.user!.id, readAt: null }, data: { readAt: new Date() } });
		return { done: true };
	},
};
