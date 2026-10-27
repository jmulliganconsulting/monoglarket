import { redirect } from '@sveltejs/kit';
import { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { linkedInEnabled, LINKEDIN_STATE_COOKIE } from '#lib/server/session.ts';
import { connectAccount, type ConnectResult } from '../../../../sse/accounts.ts';

export async function GET({ cookies, url, locals }) {
	const state = cookies.get(LINKEDIN_STATE_COOKIE);
	cookies.delete(LINKEDIN_STATE_COOKIE, { path: '/' });
	let result: ConnectResult | 'failed' = 'failed';
	try {
		// Missing code = the member pressed Cancel on LinkedIn.
		if (linkedInEnabled && state && url.searchParams.get('state') === state && url.searchParams.get('code')) {
			const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
				method: 'POST',
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: url.searchParams.get('code')!,
					client_id: LINKEDIN_CLIENT_ID!,
					client_secret: LINKEDIN_CLIENT_SECRET!,
					redirect_uri: `${url.origin}/account/linkedin/callback`,
				}),
			});
			if (res.ok) {
				// Same reasoning as Google's callback: the ID token came straight from LinkedIn over TLS with our secret.
				const claims = JSON.parse(Buffer.from((await res.json()).id_token.split('.')[1], 'base64url').toString());
				if (claims.aud === LINKEDIN_CLIENT_ID && typeof claims.sub === 'string' && claims.sub) result = await connectAccount(prisma, locals.user!.email ?? '', 'linkedInId', claims.sub);
			}
		}
	} catch {
		result = 'failed';
	}
	redirect(303, `/account?linkedin=${result}`);
}
