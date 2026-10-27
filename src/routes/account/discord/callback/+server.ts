import { redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { discordApp, DISCORD_STATE_COOKIE } from '#lib/server/session.ts';
import type { ConnectResult } from '../../../../sse/accounts.ts';
import { linkDiscord } from '../../../../sse/discord.ts';

export async function GET({ cookies, url, locals }) {
	const state = cookies.get(DISCORD_STATE_COOKIE);
	cookies.delete(DISCORD_STATE_COOKIE, { path: '/' });
	let result: ConnectResult | 'failed' = 'failed';
	const code = url.searchParams.get('code');
	// Missing code = the member pressed Cancel on Discord.
	if (discordApp && state && url.searchParams.get('state') === state && code) {
		try {
			result = await linkDiscord(prisma, discordApp, { userId: locals.user!.id, email: locals.user!.email ?? '', code, redirectUri: `${url.origin}/account/discord/callback` });
		} catch (e) {
			console.error('Connect Discord failed:', (e as Error).message);
		}
	}
	redirect(303, `/account?discord=${result}`);
}
