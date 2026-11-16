import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';
import { ALLOWED_EMAIL_DOMAINS, ALLOWED_EMAILS, APP_ENV, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SIGNIN_ENABLED, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_TOKEN_KEY, LONGTAIL_CLIENT_ID, LONGTAIL_SECRET, LONGTAIL_URL } from '$app/env/private';
import { discordTokenKey, type DiscordApp } from '../../sse/discord.ts';
import { safeNext, SESSION_TTL_MS, type Allowlist } from '../../auth/auth.ts';
import type { LongTailClient } from '../../longtail/handoff.ts';

// Cookies ignore the port on localhost, so the dev site gets its own names: a dev sign-in can't replace or read a live session.
const cookieName = (name: string) => (APP_ENV === 'dev' ? `${name}_dev` : name);

export const SESSION_COOKIE = cookieName('session');
// Remembers which email the code was sent to, so the email never goes in a URL.
export const PENDING_EMAIL_COOKIE = cookieName('login_email');
// Where to go after signing in (e.g. back to Long Tail's sign-in handoff); kept in a cookie because the code and Google steps drop the URL.
export const LOGIN_NEXT_COOKIE = cookieName('login_next');
// OAuth state for Google sign-in (CSRF check on the callback).
export const GOOGLE_STATE_COOKIE = cookieName('google_state');
// Same, for the account page's Connect LinkedIn.
export const LINKEDIN_STATE_COOKIE = cookieName('linkedin_state');
// And Connect Discord.
export const DISCORD_STATE_COOKIE = cookieName('discord_state');
// And Connect GitHub.
export const GITHUB_STATE_COOKIE = cookieName('github_state');

export const googleEnabled = GOOGLE_SIGNIN_ENABLED && !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET;

export const linkedInEnabled = !!LINKEDIN_CLIENT_ID && !!LINKEDIN_CLIENT_SECRET;

export const gitHubEnabled = !!GITHUB_CLIENT_ID && !!GITHUB_CLIENT_SECRET;

const discordKey = discordTokenKey(DISCORD_TOKEN_KEY);
if (DISCORD_TOKEN_KEY && !discordKey) console.warn('DISCORD_TOKEN_KEY must be base64 of 32 bytes (openssl rand -base64 32); Connect Discord is off');
/** Null = Connect Discord is off (client ID, secret or token key missing). */
export const discordApp: DiscordApp | null = DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && discordKey ? { clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, key: discordKey } : null;

if (LONGTAIL_SECRET && LONGTAIL_SECRET.length < 32) console.warn('LONGTAIL_SECRET must be at least 32 characters (openssl rand -base64 32); Long Tail sign-in is off');
/** Null = Long Tail sign-in is off (client ID, secret or URL missing). */
export const longTail: LongTailClient | null = LONGTAIL_CLIENT_ID && LONGTAIL_SECRET && LONGTAIL_SECRET.length >= 32 && LONGTAIL_URL ? { id: LONGTAIL_CLIENT_ID, secret: LONGTAIL_SECRET, url: LONGTAIL_URL } : null;

export const allowlist = (): Allowlist => ({ domains: ALLOWED_EMAIL_DOMAINS, emails: ALLOWED_EMAILS });

const base = { path: '/', httpOnly: true, sameSite: 'lax', secure: !dev } as const;

export function setSessionCookie(cookies: Cookies, token: string, expiresAt = new Date(Date.now() + SESSION_TTL_MS)) {
	cookies.set(SESSION_COOKIE, token, { ...base, expires: expiresAt });
}

export function setPendingEmail(cookies: Cookies, email: string) {
	cookies.set(PENDING_EMAIL_COOKIE, email, { ...base, maxAge: 15 * 60 });
}

export function setGoogleState(cookies: Cookies, state: string) {
	cookies.set(GOOGLE_STATE_COOKIE, state, { ...base, maxAge: 10 * 60 });
}

export function setLinkedInState(cookies: Cookies, state: string) {
	cookies.set(LINKEDIN_STATE_COOKIE, state, { ...base, maxAge: 10 * 60 });
}

export function setGitHubState(cookies: Cookies, state: string) {
	cookies.set(GITHUB_STATE_COOKIE, state, { ...base, maxAge: 10 * 60 });
}

export function setDiscordState(cookies: Cookies, state: string) {
	cookies.set(DISCORD_STATE_COOKIE, state, { ...base, maxAge: 10 * 60 });
}

export function setLoginNext(cookies: Cookies, next: string) {
	cookies.set(LOGIN_NEXT_COOKIE, next, { ...base, maxAge: 15 * 60 });
}

/** Where a just-signed-in member goes: the remembered path, once, else home. */
export function takeLoginNext(cookies: Cookies) {
	const next = safeNext(cookies.get(LOGIN_NEXT_COOKIE));
	cookies.delete(LOGIN_NEXT_COOKIE, { path: '/' });
	return next ?? '/';
}
