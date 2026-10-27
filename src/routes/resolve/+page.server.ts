import { error, fail } from '@sveltejs/kit';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { propose } from '../../markets/markets.ts';
import { marketMessage } from '../../markets/messages.ts';
import { discardProofs, proofsFromForm, type ProofInput } from '../../proofs/proofs.ts';

// Only members an admin has granted a market to. Everything here is one market at a time.
export async function load({ locals }) {
	const grants = await prisma.marketResolver.findMany({
		where: { userId: locals.user!.id, market: { status: { in: ['open', 'closed'] } } },
		orderBy: { createdAt: 'asc' },
		include: { market: { select: { id: true, question: true, resolutionCriteria: true, status: true, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true } } } } },
	});
	if (grants.length === 0) error(403, 'No market has been trusted to you');
	return {
		markets: grants.map((g) => ({ id: g.market.id, question: g.market.question, criteria: g.market.resolutionCriteria, status: g.market.status, outcomes: g.market.outcomes })),
	};
}

export const actions = {
	resolve: async ({ request, locals }) => {
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const granted = await prisma.marketResolver.findUnique({ where: { marketId_userId: { marketId, userId: locals.user!.id } } });
		if (!granted) error(403, 'That market has not been trusted to you');
		const dir = join(DATA_DIR, 'resolution-proofs');
		let proofs: ProofInput[] = [];
		try {
			proofs = await proofsFromForm(form, dir);
			await propose(prisma, { marketId, outcomeId: Number(form.get('outcomeId')), proposerId: locals.user!.id, evidence: String(form.get('evidence') ?? ''), proofs });
		} catch (e) {
			await discardProofs(dir, proofs);
			return fail(400, { error: e instanceof Error && !('code' in e) ? e.message : marketMessage(e), marketId });
		}
		return { done: 'Resolved. Winners are paid, and the market can be disputed for 24 hours.' };
	},
};
