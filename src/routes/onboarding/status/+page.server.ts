import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { statusBadges } from '../../../badges/badges.ts';
import { sseMemberForEmail } from '../../../sse/accounts.ts';
import { advanceFrom, elsewhere } from '../../../onboarding/onboarding.ts';
import { fileReport, reportMessage } from '../../../reports/reports.ts';

export async function load({ locals }) {
	const user = locals.user!;
	const to = elsewhere(user, 'status');
	if (to) redirect(303, to);
	const member = user.email ? await sseMemberForEmail(prisma, user.email) : null;
	return { badges: statusBadges(user, member).map((b) => b.label) };
}

export const actions = {
	// "This looks wrong": a note in the moderation queue. Nothing changes until someone acts on it (vault "Signup and profile").
	wrong: async ({ request, locals }) => {
		const body = String((await request.formData()).get('body') ?? '');
		try {
			await fileReport(prisma, { reporterId: locals.user!.id, kind: 'profile', body });
		} catch (e) {
			return fail(400, { error: reportMessage(e) });
		}
		return { reported: true };
	},
	// Named, because a page with named actions can't also have a default one.
	continue: async ({ locals }) => {
		await advanceFrom(prisma, locals.user!.id, 3);
		redirect(303, '/onboarding/optional');
	},
};
