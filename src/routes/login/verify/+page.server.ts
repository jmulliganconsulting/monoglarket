import { fail, redirect } from '@sveltejs/kit';
import { verifyLink } from '../../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { messageFor } from '../messages.ts';

// GET only shows a button: mail scanners that pre-open links must not use up the token.
export function load({ url }) {
	return { token: url.searchParams.get('token') ?? '' };
}

export const actions = {
	default: async ({ request, cookies }) => {
		const token = String((await request.formData()).get('token') ?? '');
		let result;
		try {
			result = await verifyLink(prisma, token);
		} catch (e) {
			return fail(400, { error: messageFor(e) });
		}
		setSessionCookie(cookies, result.session);
		redirect(303, '/');
	},
};
