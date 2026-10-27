import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { elsewhere, finishOnboarding } from '../../../onboarding/onboarding.ts';
import { startBreak, userMessage } from '../../../users/users.ts';
import { settleEarnings } from '../../../earn/earn.ts';
import { SITE_CURRENCY } from '$app/env/private';

export async function load({ locals }) {
	const to = elsewhere(locals.user!, 'done');
	if (to) redirect(303, to);
	const grants = await prisma.currency.findMany({ where: { kind: 'internal', active: true, signupGrant: { gt: 0 } }, select: { code: true, name: true, signupGrant: true } });
	return { grants, until: locals.user!.breakUntil };
}

export const actions = {
	finish: async ({ locals }) => {
		await finishOnboarding(prisma, locals.user!.id);
		// Backpay for memberships and event attendance, so the first visit summary shows it (vault "Visit summary").
		const currency = await prisma.currency.findUnique({ where: { code: SITE_CURRENCY } });
		if (currency) await settleEarnings(prisma, currency.id);
		// The first summary covers everything since the account was made: the signup grant and the backpay.
		await prisma.user.update({ where: { id: locals.user!.id }, data: { summarySince: locals.user!.createdAt } });
		redirect(303, '/');
	},
	break: async ({ request, locals }) => {
		try {
			await startBreak(prisma, locals.user!.id, String((await request.formData()).get('length')));
		} catch (e) {
			return fail(400, { breakError: userMessage(e) });
		}
		return { breakStarted: true };
	},
};
