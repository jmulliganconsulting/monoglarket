import { redirect } from '@sveltejs/kit';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '$app/env/private';
import { AuthError, googleSignIn } from '../../../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { allowlist, googleEnabled, GOOGLE_STATE_COOKIE, setSessionCookie } from '#lib/server/session.ts';

export async function GET({ cookies, url }) {
	const state = cookies.get(GOOGLE_STATE_COOKIE);
	cookies.delete(GOOGLE_STATE_COOKIE, { path: '/' });
	let result;
	try {
		if (!googleEnabled || !state || url.searchParams.get('state') !== state) throw new AuthError('google_failed');
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			body: new URLSearchParams({
				code: url.searchParams.get('code') ?? '',
				client_id: GOOGLE_CLIENT_ID!,
				client_secret: GOOGLE_CLIENT_SECRET!,
				redirect_uri: `${url.origin}/login/google/callback`,
				grant_type: 'authorization_code',
			}),
		});
		if (!res.ok) throw new AuthError('google_failed');
		// The ID token came straight from Google over TLS with our secret, so its signature needn't be re-checked (Google OIDC docs).
		const claims = JSON.parse(Buffer.from((await res.json()).id_token.split('.')[1], 'base64url').toString());
		if (claims.aud !== GOOGLE_CLIENT_ID || claims.email_verified !== true) throw new AuthError('google_failed');
		result = await googleSignIn(prisma, claims.email, allowlist());
	} catch (e) {
		redirect(303, `/login?error=${e instanceof AuthError ? e.code : 'google_failed'}`);
	}
	setSessionCookie(cookies, result.session);
	redirect(303, '/');
}
