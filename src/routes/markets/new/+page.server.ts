import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../auth/roles.ts';
import { createDateQuestion, createMarket, createNumericQuestion, createQuestionGroup } from '../../../markets/markets.ts';
import { marketMessage } from '../../../markets/messages.ts';

// Only moderators and admins propose markets (members trade and request resolutions).
export async function load({ locals }) {
	if (!isModerator(locals.user!.role)) error(403, 'Only moderators and admins can propose markets');
	const currency = await prisma.currency.findFirst({ where: { kind: 'internal', active: true }, select: { id: true, code: true } });
	if (!currency) error(500, 'No internal currency is set up');
	const categories = await prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
	return { currency: currency.code, categories };
}

export const actions = {
	default: async ({ request, locals }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Only moderators and admins can propose markets');
		const form = await request.formData();
		const text = (name: string) => String(form.get(name) ?? '');
		const spendCap = text('spendCap').trim();
		const categoryRaw = text('categoryId').trim();
		// 'several': each line is an option with its own yes/no market (ADR-020). 'dates': each line is a day or time ("Before 11/15", "Sunday at 3pm") in the zone picked as tz. 'numeric': each line is a range ("20-21", "32+"). Anything else: one winner.
		const kind = ['several', 'dates', 'numeric'].includes(text('kind')) ? text('kind') : 'one';
		const values = { question: text('question'), criteria: text('criteria'), outcomes: text('outcomes'), subsidy: text('subsidy'), spendCap, categoryId: categoryRaw, kind, tz: text('tz') };
		const currency = await prisma.currency.findFirst({ where: { kind: 'internal', active: true }, select: { id: true } });
		if (!currency) error(500, 'No internal currency is set up');
		const lines = values.outcomes.split('\n').map((s) => s.trim()).filter(Boolean);
		const shared = {
			question: values.question,
			criteria: values.criteria,
			currencyId: currency.id,
			subsidy: Number(values.subsidy),
			spendCap: spendCap ? Number(spendCap) : undefined,
			closeAt: text('closeAt') ? new Date(text('closeAt')) : null,
			creatorId: locals.user!.id,
			categoryId: categoryRaw ? Number(categoryRaw) : undefined,
			colorPrimary: text('colorPrimary'),
			colorSecondary: text('colorSecondary'),
		};
		let target: string;
		try {
			if (kind === 'dates') {
				target = `/questions/${await createDateQuestion(prisma, { ...shared, days: lines, tz: values.tz })}`;
			} else if (kind === 'several') {
				target = `/questions/${await createQuestionGroup(prisma, { ...shared, options: lines })}`;
			} else if (kind === 'numeric') {
				target = `/questions/${await createNumericQuestion(prisma, { ...shared, ranges: lines })}`;
			} else {
				target = `/markets/${await createMarket(prisma, { ...shared, outcomes: lines })}`;
			}
		} catch (e) {
			return fail(400, { error: marketMessage(e), values });
		}
		redirect(303, target);
	},
};
