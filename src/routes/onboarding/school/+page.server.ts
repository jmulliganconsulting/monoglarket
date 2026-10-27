import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { sseMemberForEmail } from '../../../sse/accounts.ts';
import { PROGRAMS } from '../../../sse/majors.ts';
import { elsewhere, onboardingMessage, OnboardingError, saveSchool } from '../../../onboarding/onboarding.ts';

export async function load({ locals }) {
	const user = locals.user!;
	const to = elsewhere(user, 'school');
	if (to) redirect(303, to);
	const member = user.email ? await sseMemberForEmail(prisma, user.email) : null;
	return {
		programs: PROGRAMS.map(([name, degree]) => ({ key: `${name}|${degree}`, label: `${name} (${degree})` })),
		prefill: { graduationTerm: member?.graduationTerm ?? '', graduationYear: member?.graduationYear ?? '' },
	};
}

export const actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const get = (name: string) => String(form.get(name) ?? '');
		const values = { status: get('status'), seniority: get('seniority'), graduationTerm: get('graduationTerm'), graduationYear: get('graduationYear') };
		try {
			await saveSchool(prisma, locals.user!.id, {
				status: values.status,
				seniority: values.seniority,
				onCoopTerm: form.get('onCoopTerm') === 'on',
				isTransfer: form.get('isTransfer') === 'on',
				programs: form.getAll('programs').map(String),
				graduationTerm: values.graduationTerm,
				graduationYear: values.graduationYear.trim() === '' ? null : Number(values.graduationYear),
			});
		} catch (e) {
			if (e instanceof OnboardingError) return fail(400, { error: onboardingMessage(e), values });
			throw e;
		}
		redirect(303, '/onboarding/status');
	},
};
