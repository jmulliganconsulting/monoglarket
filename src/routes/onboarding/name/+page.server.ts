import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { sseMemberForEmail } from '../../../sse/accounts.ts';
import { elsewhere, onboardingMessage, OnboardingError, saveName } from '../../../onboarding/onboarding.ts';

export async function load({ locals }) {
	const user = locals.user!;
	const to = elsewhere(user, 'name');
	if (to) redirect(303, to);
	// Pre-fill from the SSE roster when the email matches (vault "Signup and profile", screen 3).
	const member = user.email ? await sseMemberForEmail(prisma, user.email) : null;
	const [first = '', ...rest] = (member?.name ?? '').split(' ');
	return {
		prefill: {
			firstName: first,
			lastName: rest.join(' '),
			username: (user.email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20),
		},
	};
}

export const actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const get = (name: string) => String(form.get(name) ?? '');
		const values = { prefix: get('prefix'), firstName: get('firstName'), middleName: get('middleName'), lastName: get('lastName'), suffix: get('suffix'), preferredName: get('preferredName'), username: get('username'), pronouns: get('pronouns') };
		try {
			await saveName(prisma, locals.user!.id, { ...values, pronounsPublic: form.get('pronounsPublic') === 'on' });
		} catch (e) {
			if (e instanceof OnboardingError) return fail(400, { error: onboardingMessage(e), values });
			throw e;
		}
		redirect(303, '/onboarding/school');
	},
};
