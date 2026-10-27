import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../auth/roles.ts';
import { acceptProposal, approveMarket, cancel, lockMarket, reResolve, rejectMarket, rejectProposal, scheduleLock } from '../../markets/markets.ts';
import { marketMessage } from '../../markets/messages.ts';
import { handleReport, reportMessage } from '../../reports/reports.ts';
import { SOURCES } from '../../resolvers/sources.ts';
import { testSource } from '../../resolvers/resolvers.ts';

// Moderators only (vault "Auth and roles"); every action below is audited in markets.ts.
function moderatorId(locals: App.Locals): number {
	if (!locals.user || !isModerator(locals.user.role)) error(403, 'Moderators only');
	return locals.user.id;
}

export async function load({ locals }) {
	moderatorId(locals);
	const [pending, proposals, live, overdue, reports] = await Promise.all([
		prisma.market.findMany({
			where: { status: 'pending_review' },
			orderBy: { createdAt: 'asc' },
			include: { outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { label: true } }, creator: { select: { displayName: true } } },
		}),
		prisma.resolutionProposal.findMany({
			where: { status: 'pending' },
			orderBy: { createdAt: 'asc' },
			include: { market: { select: { id: true, question: true } }, outcome: { select: { label: true } }, proposer: { select: { displayName: true } }, attachments: { orderBy: { id: 'asc' } } },
		}),
		prisma.market.findMany({ where: { status: { in: ['open', 'closed'] }, deletedAt: null }, orderBy: { closeAt: 'asc' }, select: { id: true, question: true, status: true, lockedAt: true, lockAt: true, resolverSource: true } }),
		prisma.market.findMany({ where: { status: 'closed', deletedAt: null, closeAt: { lte: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { closeAt: 'asc' }, select: { id: true, question: true, closeAt: true } }),
		prisma.report.findMany({
			where: { status: 'open' },
			orderBy: { createdAt: 'asc' },
			include: { reporter: { select: { displayName: true } }, subject: { select: { displayName: true } }, market: { select: { id: true, question: true } } },
		}),
	]);
	return {
		pending: pending.map((m) => ({ id: m.id, question: m.question, criteria: m.resolutionCriteria, closeAt: m.closeAt, outcomes: m.outcomes.map((o) => o.label), creator: m.creator?.displayName ?? null, subsidy: m.subsidy })),
		proposals: proposals.map((p) => ({ id: p.id, marketId: p.market.id, question: p.market.question, outcome: p.outcome.label, evidence: p.evidence, proposer: p.proposer?.displayName ?? 'an automatic source', createdAt: p.createdAt, proofs: p.attachments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, url: a.url })) })),
		live: live.map((m) => ({ ...m, locked: !!m.lockedAt })),
		overdue: overdue.map((m) => ({ id: m.id, question: m.question, closeAt: m.closeAt })),
		disputes: (
			await prisma.market.findMany({
				where: { status: 'resolved', disputeUntil: { gt: new Date() } },
				orderBy: { disputeUntil: 'asc' },
				select: { id: true, question: true, resolvedOutcomeId: true, disputeUntil: true, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true } }, _count: { select: { reports: { where: { status: 'open', kind: 'resolution' } } } } },
			})
		).map((m) => ({ id: m.id, question: m.question, current: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.label ?? '', outcomes: m.outcomes, until: m.disputeUntil!, disputes: m._count.reports })),
		sources: Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label })),
		isAdmin: locals.user!.role === 'admin',
		reports: reports.map((r) => ({
			id: r.id,
			kind: r.kind,
			body: r.body,
			reporter: r.reporter.displayName,
			market: r.market ? { id: r.market.id, question: r.market.question } : null,
			subject: r.subject?.displayName ?? null,
			createdAt: r.createdAt,
		})),
	};
}

// Each action: id from the form, one call into markets.ts, a message on failure.
async function run(step: () => Promise<unknown>, done: string) {
	try {
		await step();
	} catch (e) {
		return fail(400, { error: marketMessage(e) });
	}
	return { done };
}

export const actions = {
	approve: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const resolverSource = String(form.get('resolverSource') ?? '') || null;
		// 'auto' is the admin-only mode; the service refuses it for anyone else (vault ADR-012).
		const resolutionMode = form.get('resolutionMode') === 'auto' ? 'auto' : 'auto_confirm';
		return run(() => approveMarket(prisma, { marketId, moderatorId: moderator, resolverSource, resolutionMode }), 'Approved. Trading is open.');
	},
	reject: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const reason = String(form.get('reason') ?? '').trim() || 'No reason given';
		return run(() => rejectMarket(prisma, { marketId, moderatorId: moderator, reason }), 'Rejected.');
	},
	accept: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const proposalId = Number((await request.formData()).get('proposalId'));
		return run(() => acceptProposal(prisma, { proposalId, moderatorId: moderator }), 'Accepted. Winners are paid.');
	},
	rejectProposal: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const proposalId = Number((await request.formData()).get('proposalId'));
		return run(() => rejectProposal(prisma, { proposalId, moderatorId: moderator }), 'Proposal rejected.');
	},
	cancel: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const reason = String(form.get('reason') ?? '').trim();
		return run(() => cancel(prisma, { marketId, moderatorId: moderator, reason }), 'Cancelled. Members were refunded and told why.');
	},
	lock: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const marketId = Number((await request.formData()).get('marketId'));
		return run(() => lockMarket(prisma, { marketId, moderatorId: moderator }), 'Trading locked until it is resolved.');
	},
	scheduleLock: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const raw = String(form.get('lockAt') ?? '');
		const lockAt = raw ? new Date(raw) : null;
		return run(() => scheduleLock(prisma, { marketId, moderatorId: moderator, lockAt }), lockAt ? 'Lock scheduled.' : 'Scheduled lock cleared.');
	},
	reResolve: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		try {
			await reResolve(prisma, { marketId, outcomeId: Number(form.get('outcomeId')), moderatorId: moderator, evidence: String(form.get('evidence') ?? '') });
		} catch (e) {
			return fail(400, { error: marketMessage(e), marketId });
		}
		return { done: 'Result changed. Winnings were corrected, and the dispute window has started again.' };
	},
	testSource: async ({ request, locals }) => {
		moderatorId(locals);
		const marketId = Number((await request.formData()).get('marketId'));
		const result = await testSource(prisma, marketId);
		return result.ok ? { testResult: result.message, marketId } : fail(400, { testResult: result.message, marketId });
	},
	report: async ({ request, locals }) => {
		const moderator = moderatorId(locals);
		const form = await request.formData();
		const outcome = form.get('outcome') === 'upheld' ? 'upheld' : 'dismissed';
		try {
			await handleReport(prisma, { reportId: Number(form.get('reportId')), moderatorId: moderator, outcome, note: String(form.get('note') ?? '') });
		} catch (e) {
			return fail(400, { error: reportMessage(e) });
		}
		return { done: outcome === 'upheld' ? 'Report upheld.' : 'Report dismissed.' };
	},
};
