import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { prices } from '../engine/lmsr.ts';
import { isModerator } from '../auth/roles.ts';
import { MarketError } from '../markets/markets.ts';
import { marketMessage } from '../markets/messages.ts';
import { pickHeadliner, recentTrades, setHeadliner } from '../markets/headliner.ts';
import { listable, viewerOf } from '../markets/visibility.ts';
import { getNumberSetting } from '../settings/settings.ts';

// Open markets (closing soon first), or decided ones (newest first). Decided markets stay here; a history page comes later (vault "Market history").
export async function load({ url, locals }) {
	const decided = url.searchParams.get('tab') === 'decided';
	const categoryKey = url.searchParams.get('category');
	const viewer = await viewerOf(prisma, locals.user!);
	// Resolved markets stay here for a while, then go to the history page. Automated ones leave at once (vault "Market history").
	const hours = await getNumberSetting(prisma, 'decided_home_hours');
	const recentDecided = { resolvedAt: { gt: new Date(Date.now() - hours * 3600_000) }, resolverSource: null };
	const found = await prisma.market.findMany({
		where: {
			...listable(viewer),
			status: decided ? { in: ['resolved', 'final', 'cancelled'] } : { in: ['open', 'closed'] },
			...(decided ? recentDecided : {}),
		},
		// Id breaks ties, so a question's options keep their creation order (they close together).
		orderBy: decided ? [{ resolvedAt: 'desc' }, { id: 'asc' }] : [{ closeAt: 'asc' }, { id: 'asc' }],
		include: { category: { select: { key: true, name: true, sort: true } }, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' } } },
	});
	// Every category is a tab, in the admin's order, even with no markets in this view yet.
	const categories = await prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { key: true, name: true, color: true } });
	const inTab = categoryKey ? found.filter((m) => m.category?.key === categoryKey) : found;
	// An open category tab leads with its headliner: the moderator's pick, else the most traded (vault "Categories and visuals").
	const headlinerId = categoryKey && !decided ? pickHeadliner(inTab, await recentTrades(prisma, inTab.map((m) => m.id))) : null;
	const markets = headlinerId === null ? inTab : [...inTab.filter((m) => m.id === headlinerId), ...inTab.filter((m) => m.id !== headlinerId)];
	return {
		decided,
		category: categoryKey,
		categories,
		headlinerId,
		canModerate: isModerator(viewer.role),
		markets: markets.map((m) => {
			const p = prices(
				m.outcomes.map((o) => o.q.toNumber()),
				m.b,
			);
			const outcomes = m.outcomes.map((o, i) => ({ id: o.id, label: o.label, probability: p[i], color: o.color, imageFile: o.imageFile }));
			return {
				id: m.id,
				question: m.question,
				status: m.status,
				closeAt: m.closeAt,
				resolvedAt: m.resolvedAt,
				winner: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? null,
				category: m.category?.name ?? null,
				categoryKey: m.category?.key ?? null,
				questionGroupId: m.questionGroupId,
				optionLabel: m.optionLabel,
				optionDate: m.optionDate,
				colorPrimary: m.colorPrimary,
				imageFile: m.imageFile,
				outcomes: outcomes.map((o) => ({ id: o.id, label: o.label, probability: o.probability, color: o.color, imageFile: o.imageFile })),
			};
		}),
	};
}

export const actions = {
	// Moderators pick the headliner from a category's open tab.
	setHeadliner: async ({ request, locals }) => {
		if (!locals.user || !isModerator(locals.user.role)) error(403, 'Moderators only');
		try {
			await setHeadliner(prisma, { marketId: Number((await request.formData()).get('marketId')), moderatorId: locals.user.id });
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { error: marketMessage(e) });
			throw e;
		}
		return { done: 'Headliner set.' };
	},
};
