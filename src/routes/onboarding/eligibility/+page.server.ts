import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { SESSION_COOKIE } from '#lib/server/session.ts';
import { elsewhere, onboardingMessage, OnboardingError, saveEligibility } from '../../../onboarding/onboarding.ts';

export function load({ locals }) {
	const to = elsewhere(locals.user!, 'eligibility');
	if (to) redirect(303, to);
	return {};
}

export const actions = {
	default: async ({ request, locals, cookies }) => {
		const form = await request.formData();
		const num = (name: string) => (String(form.get(name) ?? '').trim() === '' ? null : Number(form.get(name)));
		const values = { birthYear: String(form.get('birthYear') ?? ''), birthMonth: String(form.get('birthMonth') ?? ''), birthDay: String(form.get('birthDay') ?? ''), country: String(form.get('country') ?? ''), countryOther: String(form.get('countryOther') ?? ''), state: String(form.get('state') ?? ''), city: String(form.get('city') ?? ''), birthdayRewards: form.get('birthdayRewards') === 'on' };
		let result;
		try {
			result = await saveEligibility(prisma, locals.user!.id, {
				birthYear: Number(values.birthYear),
				birthMonth: num('birthMonth'),
				birthDay: num('birthDay'),
				birthdayRewards: form.get('birthdayRewards') === 'on',
				// "OTHER" from the dropdown means the typed name; other values are the listed codes.
				country: values.country === 'OTHER' ? values.countryOther.trim() : values.country,
				state: values.state.trim(),
				city: values.city.trim(),
				accepted: form.get('accepted') === 'on',
			});
		} catch (e) {
			if (e instanceof OnboardingError) return fail(400, { error: onboardingMessage(e), values });
			throw e;
		}
		if (result === 'blocked') {
			// Under 18: no account, no session. The block is what the login page remembers.
			cookies.delete(SESSION_COOKIE, { path: '/' });
			redirect(303, '/login?error=blocked');
		}
		redirect(303, '/onboarding/name');
	},
};
