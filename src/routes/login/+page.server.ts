import { fail, redirect } from '@sveltejs/kit';
import { passwordLogin, requestLogin, safeNext } from '../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { sendLoginEmail } from '#lib/server/email.ts';
import { allowlist, googleEnabled, LOGIN_NEXT_COOKIE, setLoginNext, setPendingEmail, setSessionCookie, takeLoginNext } from '#lib/server/session.ts';
import { authMessages, messageFor } from './messages.ts';

export function load({ locals, url, cookies }) {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next ?? '/');
	if (next) setLoginNext(cookies, next);
	// The form actions drop ?next=, so after a failed attempt the cookie still says where this sign-in is headed.
	const longTail = (next ?? safeNext(cookies.get(LOGIN_NEXT_COOKIE)))?.startsWith('/longtail/') ?? false;
	return { google: googleEnabled, showEmail: !googleEnabled || url.searchParams.has('email'), error: authMessages[url.searchParams.get('error') ?? ''], longTail };
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
		redirect(303, takeLoginNext(cookies));
	},
};
