import { fail, redirect } from '@sveltejs/kit';
import { passwordLogin, requestLogin } from '../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { sendLoginEmail } from '#lib/server/email.ts';
import { allowlist, googleEnabled, setPendingEmail, setSessionCookie } from '#lib/server/session.ts';
import { authMessages, messageFor } from './messages.ts';

export function load({ locals, url }) {
	if (locals.user) redirect(303, '/');
	return { google: googleEnabled, showEmail: !googleEnabled || url.searchParams.has('email'), error: authMessages[url.searchParams.get('error') ?? ''] };
}

export const actions = {
	email: async ({ request, cookies, url }) => {
		const email = String((await request.formData()).get('email') ?? '');
		let login;
		try {
			login = await requestLogin(prisma, email, allowlist());
		} catch (e) {
			return fail(400, { email, error: messageFor(e) });
		}
		await sendLoginEmail(login.email, login.code, `${url.origin}/login/verify?token=${login.link}`);
		setPendingEmail(cookies, login.email);
		redirect(303, '/login/code');
	},
	password: async ({ request, cookies }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		let result;
		try {
			result = await passwordLogin(prisma, email, String(form.get('password') ?? ''));
		} catch (e) {
			return fail(400, { email, passwordError: messageFor(e) });
		}
		setSessionCookie(cookies, result.session);
		redirect(303, '/');
	},
};
