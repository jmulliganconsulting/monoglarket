import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { discordApp, setDiscordState } from '#lib/server/session.ts';
import { discordAuthorizeUrl } from '../../../sse/discord.ts';

// Sends a signed-in member to Discord; Discord comes back to ./callback.
export function GET({ cookies, url }) {
	if (!discordApp) redirect(303, '/account');
	const state = randomBytes(16).toString('base64url');
	setDiscordState(cookies, state);
	redirect(303, discordAuthorizeUrl(discordApp.clientId, `${url.origin}/account/discord/callback`, state), { external: true });
}
