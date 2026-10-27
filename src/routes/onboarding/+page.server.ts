import { redirect } from '@sveltejs/kit';
import { screenFor } from '../../onboarding/onboarding.ts';

// Resume at the first unfinished screen.
export function load({ locals }) {
	const next = screenFor(locals.user!);
	redirect(303, next ? `/onboarding/${next}` : '/');
}
