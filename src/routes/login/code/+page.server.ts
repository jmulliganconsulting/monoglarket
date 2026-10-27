import { fail, redirect } from '@sveltejs/kit';
import { requestLogin, verifyCode } from '../../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { sendLoginEmail } from '#lib/server/email.ts';
import { allowlist, PENDING_EMAIL_COOKIE, setPendingEmail, setSessionCookie } from '#lib/server/session.ts';
import { messageFor } from '../messages.ts';

export function load({ cookies, locals }) {
	if (locals.user) redirect(303, '/');
	const email = cookies.get(PENDING_EMAIL_COOKIE);
	if (!email) redirect(303, '/login');
	return { email };
}

export const actions = {
	verify: async ({ request, cookies }) => {
		const email = cookies.get(PENDING_EMAIL_COOKIE);
		if (!email) redirect(303, '/login');
		const code = String((await request.formData()).get('code') ?? '');
		let result;
		try {
			result = await verifyCode(prisma, email, code);
		} catch (e) {
			return fail(400, { error: messageFor(e) });
		}
		setSessionCookie(cookies, result.session);
		cookies.delete(PENDING_EMAIL_COOKIE, { path: '/' });
		redirect(303, '/');
	},
	resend: async ({ cookies, url }) => {
		const email = cookies.get(PENDING_EMAIL_COOKIE);
		if (!email) redirect(303, '/login');
		try {
			const login = await requestLogin(prisma, email, allowlist());
			await sendLoginEmail(login.email, login.code, `${url.origin}/login/verify?token=${login.link}`);
			setPendingEmail(cookies, login.email);
		} catch (e) {
			return fail(400, { error: messageFor(e) });
		}
		return { resent: true };
	},
};
