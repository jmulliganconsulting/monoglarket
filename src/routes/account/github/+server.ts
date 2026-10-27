import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { GITHUB_CLIENT_ID } from '$app/env/private';
import { gitHubEnabled, setGitHubState } from '#lib/server/session.ts';

// Sends a signed-in member to GitHub; GitHub comes back to ./callback. No scope = read-only public profile.
export function GET({ cookies, url }) {
	if (!gitHubEnabled) redirect(303, '/account');
	const state = randomBytes(16).toString('base64url');
	setGitHubState(cookies, state);
	const params = new URLSearchParams({
		client_id: GITHUB_CLIENT_ID!,
		redirect_uri: `${url.origin}/account/github/callback`,
		scope: '',
		state,
		allow_signup: 'false',
	});
	redirect(303, `https://github.com/login/oauth/authorize?${params}`, { external: true });
}
