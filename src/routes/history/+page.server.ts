import { prisma } from '#lib/server/db.ts';
import { listable, viewerOf } from '../../markets/visibility.ts';

// History: every decided public market, newest first. Cancelled ones are here too, with their reason (vault "Market history").
export async function load({ url, locals }) {
	const categoryKey = url.searchParams.get('category');
	const viewer = await viewerOf(prisma, locals.user!);
	const [categories, markets] = await Promise.all([
		prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { key: true, name: true, color: true } }),
		prisma.market.findMany({
			where: { ...listable(viewer), status: { in: ['resolved', 'final', 'cancelled'] }, ...(categoryKey ? { category: { key: categoryKey } } : {}) },
			orderBy: { resolvedAt: 'desc' },
			take: 200,
			include: { category: { select: { name: true } }, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true } } },
		}),
	]);
	return {
		category: categoryKey,
		categories,
		markets: markets.map((m) => ({
			id: m.id,
			question: m.question,
			status: m.status,
			resolvedAt: m.resolvedAt,
			winner: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? null,
			cancelReason: m.cancelReason,
			category: m.category?.name ?? null,
		})),
	};
}
