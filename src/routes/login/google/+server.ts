import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { GOOGLE_CLIENT_ID } from '$app/env/private';
import { googleEnabled, setGoogleState } from '#lib/server/session.ts';

// Sends the browser to Google; Google comes back to ./callback.
export function GET({ cookies, url }) {
	if (!googleEnabled) redirect(303, '/login');
	const state = randomBytes(16).toString('base64url');
	setGoogleState(cookies, state);
	const params = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID!,
		redirect_uri: `${url.origin}/login/google/callback`,
		response_type: 'code',
		scope: 'openid email',
		state,
		prompt: 'select_account',
	});
	redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { external: true });
}
