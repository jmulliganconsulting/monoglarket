import { prisma } from '#lib/server/db.ts';
import { marketActivity, transactions } from '../../activity/activity.ts';

export async function load({ locals }) {
	const userId = locals.user!.id;
	const [markets, log] = await Promise.all([marketActivity(prisma, userId), transactions(prisma, userId)]);
	return {
		markets: markets.map((m) => ({ ...m, profit: m.profit })),
		log: log.map((t) => ({ ...t, at: t.at })),
	};
}
