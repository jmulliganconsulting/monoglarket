import { error, redirect } from '@sveltejs/kit';
import { callbackUrl, issueCode } from '../../../longtail/handoff.ts';
import { prisma } from '#lib/server/db.ts';
import { longTail } from '#lib/server/session.ts';

// Long Tail sends the browser here; we send it back to the game's callback with a one-time code (src/longtail/handoff.ts).
// Public in hooks.server.ts, so a member who never onboarded to the markets is not sent to /onboarding.
export async function GET({ locals, url }) {
	if (!longTail) error(404, 'Not found');
	const state = url.searchParams.get('state');
	// Never redirect on a bad request: the return address is only trusted once it matches exactly.
	if (url.searchParams.get('client_id') !== longTail.id || url.searchParams.get('redirect_uri') !== callbackUrl(longTail) || !state) error(400, 'Bad sign-in request');
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const code = await issueCode(prisma, locals.user.id);
	redirect(303, `${callbackUrl(longTail)}?${new URLSearchParams({ code, state })}`, { external: true });
}
