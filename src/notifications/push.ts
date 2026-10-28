// Web push alerts (FR-20, vault "Alerts"). Alerts are written with the event in one transaction. A job sends the recent
// ones afterwards, so an event that rolls back never reaches a phone. Without VAPID keys nothing is sent.
import webpush from 'web-push';
import { withTx, type PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export type Device = { id?: number; endpoint: string; p256dh: string; auth: string };
export type PushSender = (device: Device, payload: string) => Promise<void>;

/** The real sender for the configured keys. Tests pass their own. */
export function webPushSender(cfg: VapidConfig): PushSender {
	webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
	return async (device, payload) => {
		await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, { TTL: 3600 });
	};
}

/** Only alerts written this recently are sent, so turning alerts on doesn't flood the phone with old news. */
const RECENT_MS = 10 * 60_000;

/** Sends recent alerts to members who turned alerts on, on each of their devices. Marks every alert handled. */
export async function sendPendingPushes(prisma: PrismaClient, send: PushSender, now = new Date()) {
	const pending = await prisma.notification.findMany({
		where: { pushedAt: null, createdAt: { gt: new Date(now.getTime() - RECENT_MS) } },
		orderBy: { id: 'asc' },
		take: 200,
		select: { id: true, text: true, marketId: true, user: { select: { pushAlerts: true, pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } } } } },
	});
	let sent = 0;
	let pruned = 0;
	for (const n of pending) {
		if (n.user.pushAlerts) {
			const payload = JSON.stringify({ title: 'Monoglarket', body: n.text, url: n.marketId ? `/markets/${n.marketId}` : '/notifications' });
			for (const device of n.user.pushSubscriptions) {
				try {
					await send(device, payload);
					sent++;
				} catch (e) {
					// 404 or 410: the browser or phone has forgotten this subscription, so forget it too.
					const code = (e as { statusCode?: number }).statusCode;
					if (code === 404 || code === 410) {
						await prisma.pushSubscription.deleteMany({ where: { id: device.id } });
						pruned++;
					} else console.error(`Push failed for device ${device.id}: ${(e as Error).message}`);
				}
			}
		}
		await prisma.notification.update({ where: { id: n.id }, data: { pushedAt: now } });
	}
	return { sent, pruned };
}

/** A member turns alerts on for this device. Turning them on again just refreshes the device. */
export async function subscribeDevice(prisma: PrismaClient, userId: number, d: Device & { userAgent?: string | null }) {
	return withTx(prisma, async (db) => {
		await db.pushSubscription.upsert({
			where: { endpoint: d.endpoint },
			create: { userId, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, userAgent: d.userAgent ?? null },
			update: { userId, p256dh: d.p256dh, auth: d.auth, userAgent: d.userAgent ?? null },
		});
		await db.user.update({ where: { id: userId }, data: { pushAlerts: true } });
		await audit(db, userId, 'push_on', null, 'alerts on for this device');
	});
}

/** Turns alerts off for this device. When it was the last one, alerts go off for the member too. */
export async function unsubscribeDevice(prisma: PrismaClient, userId: number, endpoint: string) {
	return withTx(prisma, async (db) => {
		await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
		const left = await db.pushSubscription.count({ where: { userId } });
		if (left === 0) await db.user.update({ where: { id: userId }, data: { pushAlerts: false } });
		await audit(db, userId, 'push_off', null, 'alerts off for this device');
	});
}
