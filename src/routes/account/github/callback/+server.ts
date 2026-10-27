import { redirect } from '@sveltejs/kit';
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { gitHubEnabled, GITHUB_STATE_COOKIE } from '#lib/server/session.ts';
import { connectAccount, type ConnectResult } from '../../../../sse/accounts.ts';

export async function GET({ cookies, url, locals }) {
	const state = cookies.get(GITHUB_STATE_COOKIE);
	cookies.delete(GITHUB_STATE_COOKIE, { path: '/' });
	let result: ConnectResult | 'failed' = 'failed';
	try {
		// Missing code = the member pressed Cancel on GitHub.
		if (gitHubEnabled && state && url.searchParams.get('state') === state && url.searchParams.get('code')) {
			const res = await fetch('https://github.com/login/oauth/access_token', {
				method: 'POST',
				headers: { accept: 'application/json' },
				body: new URLSearchParams({
					client_id: GITHUB_CLIENT_ID!,
					client_secret: GITHUB_CLIENT_SECRET!,
					code: url.searchParams.get('code')!,
					redirect_uri: `${url.origin}/account/github/callback`,
				}),
				signal: AbortSignal.timeout(15_000),
			});
			// GitHub answers bad codes with 200 + { error }, so check for the token itself. It's used once here and not kept.
			const token = res.ok ? (await res.json()).access_token : null;
			if (typeof token === 'string') {
				const me = await fetch('https://api.github.com/user', {
					headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'club-predictions' },
					signal: AbortSignal.timeout(15_000),
				});
				const u = me.ok ? await me.json() : null;
				if (Number.isInteger(u?.id) && typeof u.login === 'string')
					result = await connectAccount(prisma, locals.user!.email ?? '', 'gitHubLinkedId', String(u.id), { gitHubLinkedLogin: u.login });
			}
		}
	} catch {
		result = 'failed';
	}
	redirect(303, `/account?github=${result}`);
}
