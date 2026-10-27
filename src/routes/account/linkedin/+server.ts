import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { LINKEDIN_CLIENT_ID } from '$app/env/private';
import { linkedInEnabled, setLinkedInState } from '#lib/server/session.ts';

// Sends a signed-in member to LinkedIn; LinkedIn comes back to ./callback.
export function GET({ cookies, url }) {
	if (!linkedInEnabled) redirect(303, '/account');
	const state = randomBytes(16).toString('base64url');
	setLinkedInState(cookies, state);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: LINKEDIN_CLIENT_ID!,
		redirect_uri: `${url.origin}/account/linkedin/callback`,
		scope: 'openid',
		state,
	});
	redirect(303, `https://www.linkedin.com/oauth/v2/authorization?${params}`, { external: true });
}
