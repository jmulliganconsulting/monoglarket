import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../auth/roles.ts';
import { canSee, viewerOf } from '../../../markets/visibility.ts';
import { prices } from '../../../engine/lmsr.ts';
import { approveQuestionGroup, editQuestion, resolveDateQuestion } from '../../../markets/markets.ts';
import { marketMessage } from '../../../markets/messages.ts';
import { winningOptions } from '#lib/winners.ts';
import { onBreak } from '../../../users/users.ts';

// The same palette the market page uses for its lines.
const palette = ['#4f7cff', '#f5a524', '#14b8a6', '#e11d48', '#8b5cf6', '#84cc16', '#06b6d4', '#f97316', '#64748b', '#d946ef'];

// A several-winner question (ADR-020): one yes/no market per option. Each option is shown only if its market is visible to this viewer.
export async function load({ params, locals }) {
	const id = Number(params.id);
	const group = await prisma.questionGroup.findUnique({ where: { id }, select: { question: true, resolutionCriteria: true, closeAt: true, createdAt: true, creator: { select: { displayName: true } } } });
	if (!group) error(404, 'No such question');
	const viewer = await viewerOf(prisma, locals.user!);
	const markets = await prisma.market.findMany({
		where: { questionGroupId: id, deletedAt: null },
		orderBy: { id: 'asc' },
		include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true, q: true } } },
	});
	const visible = markets.filter((m) => canSee(m, viewer));
	if (visible.length === 0) error(404, 'No such question');

	// Chance over time: one line per option (its Yes side), starting at the opening chance and stepping through its trades.
	const trades = await prisma.trade.findMany({
		where: { marketId: { in: visible.map((m) => m.id) } },
		orderBy: { createdAt: 'asc' },
		select: { marketId: true, outcomeId: true, probAfter: true, createdAt: true },
	});
	const chart = visible.map((m, i) => {
		const yesId = m.outcomes[0]?.id;
		return {
			label: m.optionLabel ?? m.question,
			color: palette[i % palette.length],
			points: [
				{ t: m.createdAt.getTime(), p: 1 / m.outcomes.length },
				...trades.filter((t) => t.marketId === m.id && t.outcomeId === yesId).map((t) => ({ t: t.createdAt.getTime(), p: t.probAfter })),
			],
		};
	});

	const options = visible.map((m) => {
		const yes = m.outcomes[0];
		const probability = m.status === 'pending_review' || m.status === 'rejected' ? null : prices(m.outcomes.map((o) => o.q.toNumber()), m.b)[0];
		return {
			marketId: m.id,
			label: m.optionLabel ?? m.question,
			status: m.status,
			probability,
			// Each option's own result: 'Yes', 'No', or null while it is still open.
			result: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? null,
			won: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label === 'Yes',
			optionDate: m.optionDate,
			yesLabel: yes?.label ?? 'Yes',
			// What the inline ticket needs to quote a trade: outcome 0 is Yes, outcome 1 is No (as above).
			outcomeIds: m.outcomes.map((o) => o.id),
			q: m.outcomes.map((o) => o.q.toNumber()),
			b: m.b,
			tradable: m.status === 'open' && (!m.closeAt || m.closeAt > new Date()) && !m.lockedAt && !onBreak(locals.user!),
		};
	});
	const winners = winningOptions(options).map((o) => o.label);

	return {
		question: group.question,
		criteria: group.resolutionCriteria,
		closeAt: group.closeAt,
		// Once the question has closed, its chart stops at the close rather than running on to today.
		chartEnd: group.closeAt && group.closeAt <= new Date() ? group.closeAt : null,
		creator: group.creator?.displayName ?? null,
		options,
		winners,
		categories: await prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
		categoryId: markets[0]?.categoryId ?? null,
		chart,
		isDate: markets.some((m) => m.optionDate !== null),
		canEdit: locals.user!.role === 'admin',
		canApprove: isModerator(locals.user!.role) && markets.some((m) => m.status === 'pending_review'),
		canResolveDate: isModerator(locals.user!.role) && markets.some((m) => m.optionDate !== null && (m.status === 'open' || m.status === 'closed')),
	};
}

export const actions = {
	// Admins only, like the option edit page: one save changes the question, its criteria and its close time for every option.
	edit: async ({ params, request, locals }) => {
		if (locals.user!.role !== 'admin') error(403, 'Admins only');
		const form = await request.formData();
		try {
			await editQuestion(prisma, {
				groupId: Number(params.id),
				adminId: locals.user!.id,
				question: String(form.get('question') ?? ''),
				criteria: String(form.get('criteria') ?? ''),
				closeAt: String(form.get('closeAt') ?? '') ? new Date(String(form.get('closeAt'))) : null,
				categoryId: String(form.get('categoryId') ?? '') ? Number(form.get('categoryId')) : null,
			});
		} catch (e) {
			return fail(400, { error: marketMessage(e) });
		}
		return { saved: true };
	},
	approve: async ({ params, locals }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Only moderators and admins can approve questions');
		try {
			await approveQuestionGroup(prisma, { groupId: Number(params.id), moderatorId: locals.user!.id });
		} catch (e) {
			return fail(400, { error: marketMessage(e) });
		}
		return { approved: true };
	},
	resolveDate: async ({ params, request, locals }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Only moderators and admins can resolve questions');
		// The form sends the event's time as an ISO string (the browser's local time, converted), so the day is read in UTC.
		const at = new Date(String((await request.formData()).get('at') ?? ''));
		try {
			await resolveDateQuestion(prisma, { groupId: Number(params.id), moderatorId: locals.user!.id, at });
		} catch (e) {
			return fail(400, { error: marketMessage(e) });
		}
		return { resolved: true };
	},
};
