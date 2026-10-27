import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../auth/roles.ts';
import { createDateQuestion, createMarket, createQuestionGroup } from '../../../markets/markets.ts';
import { marketMessage } from '../../../markets/messages.ts';
import { dayText, parseDay } from '../../../markets/days.ts';
import { sseMemberForEmail } from '../../../sse/accounts.ts';

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
		const lockRaw = text('lockAt').trim();
		const categoryRaw = text('categoryId').trim();
		// 'several': each line is an option with its own yes/no market (ADR-020). 'dates': each line is a day, with an "on" and a "by" option. 'people': each line is a member's username, and that member is the option. Anything else: one winner.
		const kind = ['several', 'dates', 'people'].includes(text('kind')) ? text('kind') : 'one';
		const values = { question: text('question'), criteria: text('criteria'), outcomes: text('outcomes'), subsidy: text('subsidy'), spendCap, lockAt: lockRaw, categoryId: categoryRaw, kind };
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
			lockAt: lockRaw ? new Date(lockRaw) : undefined,
			colorPrimary: text('colorPrimary'),
			colorSecondary: text('colorSecondary'),
		};
		let target: string;
		try {
			if (kind === 'dates') {
				const days = lines.map((line) => {
					const day = parseDay(line);
					return { day, text: Number.isNaN(day.getTime()) ? line : dayText(day) };
				});
				target = `/questions/${await createDateQuestion(prisma, { ...shared, days })}`;
			} else if (kind === 'several') {
				target = `/questions/${await createQuestionGroup(prisma, { ...shared, options: lines })}`;
			} else if (kind === 'people') {
				// Members are SSE members, so they need not have logged in. Each line is their RIT email.
				const members = await Promise.all(lines.map((email) => sseMemberForEmail(prisma, email)));
				const missing = lines.filter((_, i) => !members[i]);
				if (missing.length) return fail(400, { error: `No SSE member has the email ${missing.join(', ')}.`, values });
				if (new Set(lines).size !== lines.length) return fail(400, { error: 'Each member can be an option only once.', values });
				// A site user's preferred name wins; otherwise the SSE name.
				const sites = await prisma.user.findMany({ where: { email: { in: lines } }, select: { email: true, preferredName: true } });
				const names = members.map((m, i) => sites.find((u) => u.email === lines[i])?.preferredName?.trim() || m!.name);
				target = `/markets/${await createMarket(prisma, { ...shared, outcomes: names, outcomeSseMemberIds: members.map((m) => m!.id) })}`;
			} else {
				target = `/markets/${await createMarket(prisma, { ...shared, outcomes: lines })}`;
			}
		} catch (e) {
			return fail(400, { error: marketMessage(e), values });
		}
		redirect(303, target);
	},
};
