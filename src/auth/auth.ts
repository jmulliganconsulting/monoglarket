// Sign-in: email a 6-digit code + a link, or Google; after that a member may set a password.
// Design: vault notes "Auth and roles" and "Mobile experience" (why both a code and a link).
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { withTx, type Db, type PrismaClient } from '../db/db.ts';
import { account, postTransaction } from '../ledger/ledger.ts';
import { audit } from '../audit/audit.ts';
import { isPrimaryOfficer } from '../sse/accounts.ts';

export const CODE_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;
const MAX_ATTEMPTS = 5; // wrong codes before a code is dead
const MAX_CODES_PER_HOUR = 5; // per email
const MAX_PASSWORD_FAILS = 10; // per email per 15 minutes

export class AuthError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

export type Allowlist = { domains: string[]; emails: string[] };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export function normaliseEmail(raw: string): string {
	const email = raw.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('bad_email');
	return email;
}

/** Domains/emails from config; a domain of "*" allows anyone (dev only). */
export function isAllowed(email: string, allow: Allowlist): boolean {
	const domain = email.split('@')[1];
	return allow.emails.includes(email) || allow.domains.includes(domain) || allow.domains.includes('*');
}

/** Create a code + link token for `email`. Returns the raw values to put in the email; only hashes are stored. */
export async function requestLogin(prisma: PrismaClient, rawEmail: string, allow: Allowlist, now = new Date()) {
	const email = normaliseEmail(rawEmail);
	if (!isAllowed(email, allow)) throw new AuthError('not_allowed');
	const recent = await prisma.loginCode.count({ where: { email, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
	if (recent >= MAX_CODES_PER_HOUR) throw new AuthError('too_many_requests');

	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const link = token();
	await prisma.loginCode.create({ data: { email, codeHash: sha256(code), tokenHash: sha256(link), expiresAt: new Date(now.getTime() + CODE_TTL_MS) } });
	// The address stays out of the audit trail: only the fact that a code went out.
	await audit(prisma, null, 'login_code_sent', null, 'code and link emailed');
	return { email, code, link };
}

/** Check the code typed for `email` (latest live code only). Returns a new session token. */
export async function verifyCode(prisma: PrismaClient, rawEmail: string, code: string, now = new Date()) {
	const email = normaliseEmail(rawEmail);
	return withTx(prisma, async (db) => {
		const login = await db.loginCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
		if (!login || login.attempts >= MAX_ATTEMPTS) throw new AuthError('code_expired');
		const given = Buffer.from(sha256(code.replace(/\D/g, '')));
		if (!timingSafeEqual(given, Buffer.from(login.codeHash))) {
			await db.loginCode.update({ where: { id: login.id }, data: { attempts: { increment: 1 } } });
			await audit(db, null, 'sign_in_failed', null, 'wrong code');
			return null; // caller shows "wrong code"; the attempt still counts
		}
		return finishLogin(db, login.id, email, now);
	}).then((r) => {
		if (!r) throw new AuthError('wrong_code');
		return r;
	});
}

/** Sign in from the emailed link. Single use. */
export async function verifyLink(prisma: PrismaClient, link: string, now = new Date()) {
	return withTx(prisma, async (db) => {
		const login = await db.loginCode.findUnique({ where: { tokenHash: sha256(link) } });
		if (!login || login.usedAt || login.expiresAt <= now) throw new AuthError('link_expired');
		return finishLogin(db, login.id, login.email, now);
	});
}

async function finishLogin(db: Db, loginId: number, email: string, now: Date) {
	// mark used with a guard so two simultaneous verifications can't both succeed
	const used = await db.loginCode.updateMany({ where: { id: loginId, usedAt: null }, data: { usedAt: now } });
	if (used.count !== 1) throw new AuthError('code_expired');
	return startSession(db, email, now);
}

/** Sign in with an email Google has verified (the route checks the token). Creates the member on first sign-in. */
export async function googleSignIn(prisma: PrismaClient, rawEmail: string, allow: Allowlist, now = new Date()) {
	const email = normaliseEmail(rawEmail);
	if (!isAllowed(email, allow)) throw new AuthError('not_allowed');
	return withTx(prisma, (db) => startSession(db, email, now));
}

async function startSession(db: Db, email: string, now: Date) {
	// Checked on every sign-in path (code, link, Google, password) before any member row is created or used.
	if (await db.signupBlock.findFirst({ where: { email, unblockedAt: null }, select: { id: true } })) throw new AuthError('blocked');
	const user = (await db.user.findUnique({ where: { email } })) ?? (await db.user.create({ data: { email, displayName: email.split('@')[0].slice(0, 40) } }));
	// The visit summary covers everything since the last sign-in, and stays until the member has seen it (vault "Visit summary").
	// The primary officer badge is given on the first sign-in in a primary role, and kept after they leave it.
	const primaryOfficerSince = user.primaryOfficerSince ?? ((await isPrimaryOfficer(db, email)) ? now : null);
	const signedIn = await db.user.update({ where: { id: user.id }, data: { lastSignedInAt: now, summarySince: user.summarySince ?? user.lastSignedInAt ?? user.createdAt, primaryOfficerSince } });
	const session = token();
	await db.session.create({ data: { tokenHash: sha256(session), userId: user.id, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
	await audit(db, user.id, 'sign_in', null, 'session started');
	return { session, user: signedIn };
}

/**
 * The signup grant (FR-02): every active internal currency's grant to a member. Paid once, on the last onboarding screen
 * (vault "Signup and profile"); calling it again does nothing.
 */
export async function grantSignup(db: Db, userId: number) {
	const currencies = await db.currency.findMany({ where: { kind: 'internal', active: true, signupGrant: { gt: 0 } } });
	for (const c of currencies) {
		const key = `signup:${userId}:${c.id}`;
		if (await db.ledgerTransaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) continue;
		await postTransaction(db, {
			kind: 'grant',
			currencyId: c.id,
			idempotencyKey: key,
			memo: 'signup grant',
			entries: [
				{ accountId: await account(db, 'mint', 0, c.id), amount: -c.signupGrant },
				{ accountId: await account(db, 'user', userId, c.id), amount: c.signupGrant },
			],
		});
	}
}

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

async function hashPassword(password: string, salt = randomBytes(16)) {
	return `scrypt$${salt.toString('base64')}$${(await scryptAsync(password, salt, 32)).toString('base64')}`;
}

/** Set or replace the member's password and sign out their other browsers. */
export async function setPassword(prisma: PrismaClient, userId: number, password: string, keepSession?: string) {
	if (password.length < 8 || password.length > 200) throw new AuthError('weak_password');
	await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
	await prisma.session.deleteMany({ where: { userId, tokenHash: { not: sha256(keepSession ?? '') } } });
	await audit(prisma, userId, 'password_set', null, 'other sessions signed out');
}

// shortcut: in-memory per-process failure count, fine for one app container; move to a table if we run several.
const passwordFails = new Map<string, number[]>();
const DUMMY_HASH = await hashPassword('dummy');

/** Email + password sign-in for members who set one. Never creates a member. */
export async function passwordLogin(prisma: PrismaClient, rawEmail: string, password: string, now = new Date()) {
	const email = normaliseEmail(rawEmail);
	const fails = (passwordFails.get(email) ?? []).filter((t) => t > now.getTime() - 15 * 60_000);
	if (fails.length >= MAX_PASSWORD_FAILS) throw new AuthError('too_many_requests');
	const user = await prisma.user.findUnique({ where: { email } });
	// always run scrypt so response time doesn't reveal who has a password
	const [, salt, hash] = (user?.passwordHash ?? DUMMY_HASH).split('$');
	const given = (await hashPassword(password, Buffer.from(salt, 'base64'))).split('$')[2];
	if (!user?.passwordHash || !timingSafeEqual(Buffer.from(given), Buffer.from(hash))) {
		passwordFails.set(email, [...fails, now.getTime()]);
			await audit(prisma, user?.id ?? null, 'sign_in_failed', null, 'wrong password');
		throw new AuthError('wrong_password');
	}
	return withTx(prisma, (db) => startSession(db, email, now));
}

/** User for a session cookie, or null. Extends the session when it's past halfway (sliding 30 days). */
export async function getSession(prisma: PrismaClient, session: string | undefined, now = new Date()) {
	if (!session) return null;
	const row = await prisma.session.findUnique({ where: { tokenHash: sha256(session) }, include: { user: true } });
	if (!row || row.expiresAt <= now) return null;
	let expiresAt = row.expiresAt;
	if (expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
		expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
		await prisma.session.update({ where: { id: row.id }, data: { expiresAt } });
	}
	return { user: row.user, expiresAt };
}

export async function signOut(prisma: PrismaClient, session: string | undefined) {
	if (!session) return;
	const row = await prisma.session.findUnique({ where: { tokenHash: sha256(session) }, select: { userId: true } });
	if (!row) return;
	await prisma.session.deleteMany({ where: { tokenHash: sha256(session) } });
	await audit(prisma, row.userId, 'sign_out', null, 'session ended');
}
