import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../../auth/roles.ts';
import { addOutcome, deleteMarket, editMarket, removeOutcome, setVisibility, MarketError } from '../../../../markets/markets.ts';
import { marketMessage } from '../../../../markets/messages.ts';
import { userMessage } from '../../../../users/users.ts';

// Editing a market (vault "Market editing"). Admins change the words and times and delete; moderators and admins change options and visibility.
export async function load({ params, locals }) {
	const user = locals.user!;
	if (!isModerator(user.role)) error(403, 'Moderators only');
	const m = await prisma.market.findUnique({ where: { id: Number(params.id) }, include: { outcomes: { orderBy: { sort: 'asc' } } } });
	if (!m) error(404, 'No such market');
	const [categories, groups] = await Promise.all([
		prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
		prisma.userGroup.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
	]);
	return {
		isAdmin: user.role === 'admin',
		market: { id: m.id, question: m.question, criteria: m.resolutionCriteria, closeAt: m.closeAt, categoryId: m.categoryId, status: m.status, visibility: m.visibility, groupId: m.groupId, deleted: !!m.deletedAt },
		outcomes: m.outcomes.filter((o) => !o.removedAt).map((o) => ({ id: o.id, label: o.label })),
		removed: m.outcomes.filter((o) => o.removedAt).map((o) => ({ id: o.id, label: o.label })),
		categories,
		groups,
	};
}

const message = (e: unknown) => (e instanceof MarketError ? marketMessage(e) : userMessage(e));

export const actions = {
	details: async ({ request, locals, params }) => {
		if (locals.user!.role !== 'admin') error(403, 'Admins only');
		const form = await request.formData();
		const closeRaw = String(form.get('closeAt') ?? '');
		const categoryRaw = String(form.get('categoryId') ?? '');
		try {
			await editMarket(prisma, {
				marketId: Number(params.id),
				adminId: locals.user!.id,
				question: String(form.get('question') ?? ''),
				criteria: String(form.get('criteria') ?? ''),
				closeAt: closeRaw ? new Date(closeRaw) : null,
				categoryId: categoryRaw ? Number(categoryRaw) : null,
			});
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Saved.' };
	},
	addOption: async ({ request, locals, params }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
		const form = await request.formData();
		try {
			await addOutcome(prisma, { marketId: Number(params.id), moderatorId: locals.user!.id, label: String(form.get('label') ?? '') });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Option added. The other prices move to make room for it.' };
	},
	removeOption: async ({ request, locals }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
		const form = await request.formData();
		try {
			await removeOutcome(prisma, { outcomeId: Number(form.get('outcomeId')), moderatorId: locals.user!.id, reason: String(form.get('reason') ?? '') });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Option removed. Everyone who bought it was refunded, and told why.' };
	},
	visibility: async ({ request, locals, params }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
		const form = await request.formData();
		const groupRaw = String(form.get('groupId') ?? '');
		try {
			await setVisibility(prisma, { marketId: Number(params.id), moderatorId: locals.user!.id, visibility: String(form.get('visibility')), groupId: groupRaw ? Number(groupRaw) : null });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Visibility saved.' };
	},
	delete: async ({ request, locals, params }) => {
		if (locals.user!.role !== 'admin') error(403, 'Admins only');
		const form = await request.formData();
		try {
			await deleteMarket(prisma, { marketId: Number(params.id), adminId: locals.user!.id, reason: String(form.get('reason') ?? '') });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { deleted: true };
	},
};
