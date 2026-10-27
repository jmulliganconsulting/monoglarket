import { redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { advanceFrom, elsewhere } from '../../../onboarding/onboarding.ts';

export function load({ locals }) {
	const to = elsewhere(locals.user!, 'optional');
	if (to) redirect(303, to);
	return {};
}

// Connecting Discord, GitHub or LinkedIn is optional and lives on /account, so this screen only moves on.
export const actions = {
	default: async ({ locals }) => {
		await advanceFrom(prisma, locals.user!.id, 4);
		redirect(303, '/onboarding/done');
	},
};
