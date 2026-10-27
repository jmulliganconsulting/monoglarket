import { error, fail } from '@sveltejs/kit';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../auth/roles.ts';
import { canSee, viewerOf } from '../../../markets/visibility.ts';
import { hideComment, postComment } from '../../../comments/comments.ts';
import { userMessage } from '../../../users/users.ts';
import { prices } from '../../../engine/lmsr.ts';
import { buy, propose, sell } from '../../../markets/markets.ts';
import { marketMessage } from '../../../markets/messages.ts';
import { fileReport, reportMessage } from '../../../reports/reports.ts';
import { SOURCES } from '../../../resolvers/sources.ts';
import { onBreak } from '../../../users/users.ts';
import { tradeAllowed } from '../../../markets/limits.ts';
import { discardProofs, proofsFromForm, type ProofInput } from '../../../proofs/proofs.ts';

export async function load({ params, locals }) {
	const id = Number(params.id);
	const m = await prisma.market.findUnique({
		where: { id },
		include: {
			currency: { select: { code: true } },
			creator: { select: { displayName: true } },
			outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, include: { sseMember: { select: { imageFile: true } } } },
		},
	});
	if (!m || !canSee(m, await viewerOf(prisma, locals.user!))) error(404, 'No such market');
	const userId = locals.user!.id;

	const q = m.outcomes.map((o) => o.q.toNumber());
	const p = prices(q, m.b);
	const [proposals, trades, feed, positions, account] = await Promise.all([
		prisma.resolutionProposal.findMany({
			where: { marketId: id, status: { in: ['pending', 'accepted'] } },
			orderBy: { createdAt: 'desc' },
			take: 5,
			include: { outcome: { select: { label: true } }, proposer: { select: { displayName: true } }, attachments: { orderBy: { id: 'asc' } } },
		}),
		prisma.trade.findMany({ where: { marketId: id }, orderBy: { createdAt: 'asc' }, select: { outcomeId: true, probAfter: true, createdAt: true } }),
		prisma.trade.findMany({
			where: { marketId: id },
			orderBy: { createdAt: 'desc' },
			take: 20,
			include: { user: { select: { id: true, displayName: true } }, outcome: { select: { label: true } } },
		}),
		prisma.position.findMany({ where: { marketId: id, userId }, select: { outcomeId: true, shares: true, netSpent: true } }),
		prisma.account.findUnique({
			where: { ownerType_ownerId_currencyId: { ownerType: 'user', ownerId: userId, currencyId: m.currencyId } },
			select: { balance: true },
		}),
	]);

	// Price history per outcome: starts at the uniform opening price, then one point per trade (the chart's data).
	const start = m.createdAt.getTime();
	const series = m.outcomes.map((o, i) => ({
		label: o.label,
		points: [{ t: start, p: 1 / m.outcomes.length }, ...trades.filter((t) => t.outcomeId === o.id).map((t) => ({ t: t.createdAt.getTime(), p: t.probAfter }))],
	}));

	// Moderators and admins always see the controls. Ordinary members never propose a result, unless a moderator has
	// granted them this market (vault "Resolution and payouts").
	const moderator = isModerator(locals.user!.role);
	const granted = !moderator && !!(await prisma.marketResolver.findUnique({ where: { marketId_userId: { marketId: id, userId } } }));

	// Comments, newest first. Hidden ones show only to moderators, marked as hidden (FR-13).
	const comments = await prisma.marketComment.findMany({
		where: { marketId: id, ...(moderator ? {} : { hiddenAt: null }) },
		orderBy: { createdAt: 'desc' },
		take: 100,
		select: { id: true, body: true, createdAt: true, hiddenAt: true, userId: true, user: { select: { displayName: true, username: true } } },
	});
	return {
		canModerate: moderator,
		canResolve: moderator || granted,
		comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, hidden: !!c.hiddenAt, who: c.user.username ? `@${c.user.username}` : c.user.displayName, whoId: c.userId, mine: c.userId === userId })),
		market: {
			id: m.id,
			question: m.question,
			criteria: m.resolutionCriteria,
			status: m.status,
			closeAt: m.closeAt,
			currency: m.currency.code,
			creator: m.creator?.displayName ?? null,
			questionGroupId: m.questionGroupId,
			optionLabel: m.optionLabel,
			b: m.b,
			spendCap: m.spendCap,
			resolvedOutcomeId: m.resolvedOutcomeId,
			cancelReason: m.cancelReason,
			deleted: !!m.deletedAt,
			visibility: m.visibility,
			disputeOpen: m.status === 'resolved' && !!m.disputeUntil && m.disputeUntil > new Date(),
			colorPrimary: m.colorPrimary,
			colorSecondary: m.colorSecondary,
			imageFile: m.imageFile,
			resolvedAt: m.resolvedAt,
			disputeUntil: m.disputeUntil,
			tradable: m.status === 'open' && (!m.closeAt || m.closeAt > new Date()) && !m.lockedAt && !onBreak(locals.user!),
			// Once closed, the chart stops at the close (or the resolution, if it had no set close time) rather than today.
			chartEnd: m.status === 'open' || m.status === 'pending_review' ? null : (m.closeAt ?? m.resolvedAt),
			locked: !!m.lockedAt,
			onBreak: onBreak(locals.user!) ? locals.user!.breakUntil : null,
			resolution: m.resolverSource ? (SOURCES[m.resolverSource]?.label ?? null) : null,
		},
		// A member's option shows their SSE profile picture; no picture means the colour swatch.
		outcomes: m.outcomes.map((o, i) => ({ id: o.id, label: o.label, q: q[i], probability: p[i], color: o.color, imageFile: o.imageFile, avatar: o.sseMember?.imageFile ? `/sse-images/${o.sseMember.imageFile}` : null })),
		series,
		proposals: proposals.map((x) => ({
			id: x.id,
			outcome: x.outcome.label,
			evidence: x.evidence,
			status: x.status,
			proposer: x.proposer?.displayName ?? 'an automatic source',
			createdAt: x.createdAt,
			proofs: x.attachments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, url: a.url })),
		})),
		feed: feed.map((t) => ({ id: t.id, who: t.user.displayName, whoId: t.user.id, outcome: t.outcome.label, shares: t.shares.toNumber(), amount: t.amount, probAfter: t.probAfter, createdAt: t.createdAt })),
		positions: positions.map((x) => ({ outcomeId: x.outcomeId, shares: x.shares.toNumber(), netSpent: x.netSpent })),
		balance: account?.balance ?? 0,
	};
}

export const actions = {
	// The client sends an idempotency key per form; prefixing it with the member makes keys unique across members.
	buy: async ({ request, locals, params }) => {
		if (!tradeAllowed(locals.user!.id)) return fail(429, { tradeError: 'Too many trades in a minute. Wait a moment and try again.' });
		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		if (!key) return fail(400, { tradeError: 'Reload the page and try again.' });
		try {
			await buy(prisma, {
				userId: locals.user!.id,
				marketId: Number(params.id),
				outcomeId: Number(form.get('outcomeId')),
				spend: Number(form.get('spend')),
				minShares: Number(form.get('minShares')),
				idempotencyKey: `buy:${locals.user!.id}:${key}`,
			});
		} catch (e) {
			return fail(400, { tradeError: marketMessage(e) });
		}
		return { traded: 'buy' };
	},
	sell: async ({ request, locals, params }) => {
		if (!tradeAllowed(locals.user!.id)) return fail(429, { tradeError: 'Too many trades in a minute. Wait a moment and try again.' });
		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		if (!key) return fail(400, { tradeError: 'Reload the page and try again.' });
		try {
			await sell(prisma, {
				userId: locals.user!.id,
				marketId: Number(params.id),
				outcomeId: Number(form.get('outcomeId')),
				// 'all' is a cash out: the whole position in one tap (vault ADR-021). Same fee and refusal rules as a sell.
				shares: form.get('shares') === 'all' ? 'all' : Number(form.get('shares')),
				minProceeds: Number(form.get('minProceeds')),
				idempotencyKey: `sell:${locals.user!.id}:${key}`,
			});
		} catch (e) {
			return fail(400, { tradeError: marketMessage(e) });
		}
		return { traded: 'sell' };
	},
	report: async ({ request, locals, params }) => {
		const form = await request.formData();
		try {
			await fileReport(prisma, { reporterId: locals.user!.id, kind: String(form.get('kind')), marketId: Number(params.id), body: String(form.get('body') ?? '') });
		} catch (e) {
			return fail(400, { reportError: reportMessage(e) });
		}
		return { reported: true };
	},
	comment: async ({ request, locals, params }) => {
		const form = await request.formData();
		try {
			await postComment(prisma, { marketId: Number(params.id), userId: locals.user!.id, body: String(form.get('body') ?? '') });
		} catch (e) {
			return fail(400, { commentError: userMessage(e) });
		}
		return { commented: true };
	},
	hide: async ({ request, locals }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
		const form = await request.formData();
		try {
			await hideComment(prisma, { commentId: Number(form.get('commentId')), moderatorId: locals.user!.id });
		} catch (e) {
			return fail(400, { commentError: userMessage(e) });
		}
		return { hidden: true };
	},
	propose: async ({ request, locals, params }) => {
		const form = await request.formData();
		const dir = join(DATA_DIR, 'resolution-proofs');
		let proofs: ProofInput[] = [];
		try {
			proofs = await proofsFromForm(form, dir);
			await propose(prisma, { marketId: Number(params.id), outcomeId: Number(form.get('outcomeId')), proposerId: locals.user!.id, evidence: String(form.get('evidence') ?? ''), proofs });
		} catch (e) {
			// Nothing is kept for a refused proposal: remove any picture or PDF already saved.
			await discardProofs(dir, proofs);
			return fail(400, { proposeError: e instanceof Error && !('code' in e) ? e.message : marketMessage(e) });
		}
		return { proposed: true };
	},
};
