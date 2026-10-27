// Connect Discord: the OAuth code exchange, what the granted scopes let us read, and where it's kept (DiscordAccount,
// DiscordConnection, SseMember.discordId). Tokens are kept, sealed, so linked roles can be pushed later without a relink:
// that's PUT /users/@me/applications/{app id}/role-connection with the member's own access token (role_connections.write);
// registering the role metadata schema is a one-time call with the bot token, no member scope needed.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';
import { connectAccount, sseMemberForEmail, unlinkAccount, type ConnectResult } from './accounts.ts';
import type { Fetch } from './resolve.ts';

const API = 'https://discord.com/api/v10';
/** Asked for on every connect. Members can untick some; DiscordAccount.scopes has what was granted. */
export const DISCORD_SCOPES = ['identify', 'email', 'connections', 'role_connections.write'];

export type DiscordApp = { clientId: string; clientSecret: string; /** 32 bytes, from DISCORD_TOKEN_KEY */ key: Buffer; fetchFn?: Fetch };

export function discordAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
	const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: DISCORD_SCOPES.join(' '), state, prompt: 'consent' });
	return `https://discord.com/oauth2/authorize?${params}`;
}

/** DISCORD_TOKEN_KEY (base64 of 32 random bytes: openssl rand -base64 32) as a key; null if unset or the wrong size. */
export function discordTokenKey(base64: string | undefined) {
	const key = base64 ? Buffer.from(base64, 'base64') : null;
	return key?.length === 32 ? key : null;
}

/** AES-256-GCM; iv + tag + ciphertext, base64url. */
export function sealToken(key: Buffer, token: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function openToken(key: Buffer, sealed: string) {
	const raw = Buffer.from(sealed, 'base64url');
	const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(12, 28));
	return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const discordAvatarUrl = (id: string, avatar: string | null) => (avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null);

type Token = { access_token: string; refresh_token: string; expires_in: number; scope: string };
type Connection = { id: string; name: string; type: string; verified?: boolean; revoked?: boolean; visibility?: number; friend_sync?: boolean; show_activity?: boolean; two_way_link?: boolean };

async function call<T>(app: DiscordApp, path: string, init: RequestInit): Promise<T> {
	const res = await (app.fetchFn ?? fetch)(`${API}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`Discord ${path}: HTTP ${res.status}`);
	return res.json();
}

/** Best effort: revoking the refresh token also kills its access tokens. */
async function revoke(app: DiscordApp, token: string) {
	await (app.fetchFn ?? fetch)(`${API}/oauth2/token/revoke`, {
		method: 'POST',
		body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret }),
		signal: AbortSignal.timeout(15_000),
	}).catch(() => {});
}

const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** The OAuth callback: exchange the code, read what the scopes allow, link to the member's SSE row. Throws on Discord errors. */
export async function linkDiscord(prisma: PrismaClient, app: DiscordApp, a: { userId: number; email: string; code: string; redirectUri: string }): Promise<ConnectResult> {
	const token = await call<Token>(app, '/oauth2/token', {
		method: 'POST',
		body: new URLSearchParams({ grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri, client_id: app.clientId, client_secret: app.clientSecret }),
	});
	const scopes = String(token.scope ?? '').split(' ');
	const auth = { headers: { authorization: `Bearer ${token.access_token}` } };
	const me = await call<Record<string, unknown>>(app, '/users/@me', auth);
	if (typeof me.id !== 'string' || !/^\d+$/.test(me.id) || typeof me.username !== 'string') throw new Error('Discord /users/@me: unexpected shape');
	const id = me.id;
	const username = me.username;
	const connections = scopes.includes('connections') ? await call<Connection[]>(app, '/users/@me/connections', auth) : null;

	const result = await connectAccount(prisma, a.email, 'discordId', id);
	if (result !== 'connected') {
		await revoke(app, token.refresh_token);
		return result;
	}
	const member = (await sseMemberForEmail(prisma, a.email))!;
	const now = new Date();
	const data = {
		userId: a.userId,
		memberId: member.id,
		scopes: scopes.join(' '),
		accessToken: sealToken(app.key, token.access_token),
		refreshToken: sealToken(app.key, token.refresh_token),
		tokenExpiresAt: new Date(now.getTime() + Number(token.expires_in) * 1000),
		username,
		globalName: str(me.global_name),
		avatar: str(me.avatar),
		banner: str(me.banner),
		accentColor: int(me.accent_color),
		locale: str(me.locale),
		mfaEnabled: bool(me.mfa_enabled),
		premiumType: int(me.premium_type),
		flags: int(me.flags),
		publicFlags: int(me.public_flags),
		email: scopes.includes('email') ? str(me.email) : null,
		emailVerified: scopes.includes('email') ? bool(me.verified) : null,
		rawUser: me as object,
		linkedAt: now,
		unlinkedAt: null,
	};
	await prisma.$transaction(async (db) => {
		// A different Discord account this member linked before.
		await db.discordAccount.updateMany({ where: { memberId: member.id, id: { not: id }, unlinkedAt: null }, data: { unlinkedAt: now, accessToken: null, refreshToken: null, tokenExpiresAt: null } });
		await db.discordAccount.upsert({ where: { id: id }, create: { id: id, ...data }, update: data });
		await db.sseMember.update({ where: { id: member.id }, data: { discordUsername: username } });
		await audit(db, a.userId, 'link_discord', null, 'Discord connected');
		if (!connections) return; // scope unticked: keep what we had
		const valid = connections.filter((c) => typeof c?.type === 'string' && typeof c.id === 'string');
		for (const c of valid) {
			const row = {
				name: String(c.name ?? ''),
				verified: !!c.verified,
				revoked: !!c.revoked,
				visibility: int(c.visibility),
				friendSync: bool(c.friend_sync),
				showActivity: bool(c.show_activity),
				twoWayLink: bool(c.two_way_link),
				raw: c as object,
				removedAt: null,
			};
			const key = { discordId: id, type: c.type, externalId: c.id };
			await db.discordConnection.upsert({ where: { discordId_type_externalId: key }, create: { ...key, ...row }, update: row });
		}
		const kept = new Set(valid.map((c) => `${c.type}:${c.id}`));
		const gone = (await db.discordConnection.findMany({ where: { discordId: id, removedAt: null } })).filter((c) => !kept.has(`${c.type}:${c.externalId}`));
		await db.discordConnection.updateMany({ where: { id: { in: gone.map((c) => c.id) } }, data: { removedAt: now } });
	});
	return 'connected';
}

/** The member's Disconnect: revoke at Discord, then forget the tokens and the link (history rows stay). */
export async function unlinkDiscord(prisma: PrismaClient, app: DiscordApp, email: string) {
	const member = await sseMemberForEmail(prisma, email);
	if (!member) return;
	for (const acc of await prisma.discordAccount.findMany({ where: { memberId: member.id, refreshToken: { not: null } } })) {
		try {
			await revoke(app, openToken(app.key, acc.refreshToken!));
		} catch {} // sealed with an older key: nothing to revoke with
	}
	await unlinkAccount(prisma, member.id, 'discordId');
}
