// Long Tail, the puzzle game on its own subdomain, signs members in through this site: a one-client authorization-code handoff.
// /longtail/authorize issues a code and sends the browser back to the game; the game's server swaps the code, with the shared secret,
// at /api/longtail/token for the member's id, name and admin flag. No email leaves this site. Design: Long Tail spec, "Shared sign-in".
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '../db/db.ts';
import { isModerator } from '../auth/roles.ts';

export const HANDOFF_TTL_MS = 60_000;

export type LongTailClient = { id: string; secret: string; url: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** The only address a code is ever sent to. */
export const callbackUrl = (c: LongTailClient) => `${c.url.replace(/\/+$/, '')}/auth/callback`;

/** Compares digests, so the time taken doesn't depend on how much of the secret was right. */
export const secretMatches = (sent: string, c: LongTailClient) => timingSafeEqual(sha256(sent), sha256(c.secret));

/** A fresh one-time code for `userId`; only its hash is stored. */
// shortcut: used and expired rows are never deleted; add a cleanup to the hourly job if the table ever matters.
export async function issueCode(prisma: PrismaClient, userId: number, now = new Date()) {
	const code = randomBytes(32).toString('base64url');
	await prisma.handoffCode.create({ data: { codeHash: sha256(code).toString('hex'), userId, expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS) } });
	return code;
}

/** Spends a code: the member it was issued for, or null if it is unknown, expired or already used. */
export async function exchangeCode(prisma: PrismaClient, code: string, now = new Date()) {
	const codeHash = sha256(code).toString('hex');
	// One conditional update, so two racing exchanges of the same code can't both win.
	const { count } = await prisma.handoffCode.updateMany({ where: { codeHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
	if (count !== 1) return null;
	const { user } = await prisma.handoffCode.findUniqueOrThrow({ where: { codeHash }, include: { user: true } });
	return { userId: user.id, displayName: user.displayName, isAdmin: isModerator(user.role) };
}
