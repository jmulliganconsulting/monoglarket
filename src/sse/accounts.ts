// Ties a member's outside accounts to their SSE mirror row, by each service's stable id (survives renames):
// LinkedIn's OpenID "sub", Discord's user id, GitHub's user id. Set by the member signing in (connectAccount, 'oauth') or by an admin
// (linkManually via npm run sse:link, 'manual'). A new service = unique id + *LinkedVia columns on SseMember and an entry in VIA.
import type { Db, Prisma, PrismaClient } from '../db/db.ts';
import { audit } from '../audit/audit.ts';

/** The site member with this email, for the audit trail. Null when there is none (the SSE record may not have signed in yet). */
async function actorFor(prisma: PrismaClient, email: string | null) {
	return email ? ((await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null) : null;
}
import { linkedInSlug, ritEmail } from './normalize.ts';

/** The SSE row for a local user. The SSE site stores Google's @g.rit.edu form, our users may have plain @rit.edu: try both. */
export function sseMemberForEmail(prisma: PrismaClient, email: string) {
	return prisma.sseMember.findFirst({ where: { email: { in: sseEmailForms(email) }, removedAt: null } });
}

/** Holds a primary position on the SSE site right now: an active role the site still lists. */
export async function isPrimaryOfficer(db: Db, email: string) {
	const role = await db.sseOfficer.findFirst({
		where: { isPrimary: true, isActive: true, removedAt: null, member: { email: { in: sseEmailForms(email) }, removedAt: null } },
		select: { id: true },
	});
	return role !== null;
}

const sseEmailForms = (email: string) => {
	const plain = ritEmail(email.trim().toLowerCase());
	return [plain, plain.replace(/@rit\.edu$/, '@g.rit.edu')];
};

const VIA = { linkedInId: 'linkedInLinkedVia', discordId: 'discordLinkedVia', gitHubLinkedId: 'gitHubLinkedVia' } as const;
export type LinkedAccount = keyof typeof VIA;
export type ConnectResult = 'connected' | 'no_member' | 'taken';

const ownerOf = (prisma: PrismaClient, account: LinkedAccount, id: string) => prisma.sseMember.findFirst({ where: { [account]: id }, select: { id: true, email: true } });

/** extra: more columns to set with the id, e.g. the GitHub username. */
export async function connectAccount(prisma: PrismaClient, email: string, account: LinkedAccount, id: string, extra: Prisma.SseMemberUpdateInput = {}): Promise<ConnectResult> {
	const member = await sseMemberForEmail(prisma, email);
	if (!member) return 'no_member';
	const owner = await ownerOf(prisma, account, id);
	if (owner && owner.id !== member.id) return 'taken'; // one outside account per SSE member
	await prisma.sseMember.update({ where: { id: member.id }, data: { [account]: id, [VIA[account]]: 'oauth', ...extra } });
	await audit(prisma, await actorFor(prisma, email), 'link_account', null, `${account} connected`);
	return 'connected';
}

export async function disconnectAccount(prisma: PrismaClient, email: string, account: LinkedAccount) {
	const member = await sseMemberForEmail(prisma, email);
	if (member) await unlinkAccount(prisma, member.id, account);
}

/**
 * Clears the id, how it was linked, and the admin-set name (Discord username / LinkedIn slug, the next sync restores the SSE-given slug /
 * GitHub username at connect time).
 * Discord: also forgets stored OAuth tokens (unlinkDiscord revokes them at Discord first). DiscordAccount rows stay as history.
 */
export async function unlinkAccount(prisma: PrismaClient, memberId: number, account: LinkedAccount) {
	const extra = { discordId: { discordUsername: null }, linkedInId: { linkedInSlugManual: null }, gitHubLinkedId: { gitHubLinkedLogin: null } }[account];
	if (account === 'discordId')
		await prisma.discordAccount.updateMany({ where: { memberId, unlinkedAt: null }, data: { unlinkedAt: new Date(), accessToken: null, refreshToken: null, tokenExpiresAt: null } });
	const updated = await prisma.sseMember.update({ where: { id: memberId }, data: { [account]: null, [VIA[account]]: null, ...extra } });
	await audit(prisma, await actorFor(prisma, updated.email), 'unlink_account', null, `${account} removed`);
	return updated;
}

export type ManualLinks = { discordId?: string; discordUsername?: string; linkedInId?: string; linkedInSlug?: string };

/** Admin links; any subset of fields. Throws a readable Error on bad input or an id another member already holds. */
export async function linkManually(prisma: PrismaClient, memberId: number, links: ManualLinks) {
	const data: Prisma.SseMemberUpdateInput = {};
	if (links.discordId !== undefined) {
		const id = links.discordId.trim();
		if (!/^\d{17,20}$/.test(id)) throw new Error('Discord id is the 17-20 digit number (Developer Mode, right-click the user, Copy User ID)');
		Object.assign(data, { discordId: id, discordLinkedVia: 'manual' });
	}
	if (links.discordUsername !== undefined) {
		const name = links.discordUsername.trim().replace(/^@/, '').toLowerCase();
		if (!/^[a-z0-9_.]{2,32}$/.test(name)) throw new Error(`"${links.discordUsername}" isn't a Discord username (2-32 of a-z 0-9 _ .)`);
		data.discordUsername = name;
	}
	if (links.linkedInId !== undefined) {
		if (!links.linkedInId.trim()) throw new Error('LinkedIn id is empty');
		Object.assign(data, { linkedInId: links.linkedInId.trim(), linkedInLinkedVia: 'manual' });
	}
	if (links.linkedInSlug !== undefined) {
		const slug = linkedInSlug(links.linkedInSlug);
		if (!slug) throw new Error(`"${links.linkedInSlug}" isn't a LinkedIn profile URL or slug`);
		Object.assign(data, { linkedInSlugManual: slug, resolvedLinkedIn: slug, linkedInValid: true });
	}
	for (const account of ['discordId', 'linkedInId'] as const) {
		const id = data[account] as string | undefined;
		const owner = id && (await ownerOf(prisma, account, id));
		if (owner && owner.id !== memberId) throw new Error(`${account} ${id} is already linked to SSE user ${owner.id} (${owner.email}); unlink it there first`);
	}
	const updated = await prisma.sseMember.update({ where: { id: memberId }, data });
	await audit(prisma, await actorFor(prisma, updated.email), 'update_links', null, Object.keys(data).join(', '));
	return updated;
}
