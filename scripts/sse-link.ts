// Admin: link or unlink a member's Discord / LinkedIn by hand. Run on the server (it uses DATABASE_URL):
//   npm run sse:link -- <email | SSE user id> [--discord-id 80351110224678912] [--discord-username name]
//                                             [--linkedin-id <OpenID sub>] [--linkedin-slug <URL or slug>]
//   npm run sse:link -- <email | SSE user id> --unlink discord|linkedin|github
//   npm run sse:link -- <email | SSE user id>          (show current links)
import { parseArgs } from 'node:util';
import { createPrisma } from '../src/db/db.ts';
import { linkManually, sseMemberForEmail, unlinkAccount } from '../src/sse/accounts.ts';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		'discord-id': { type: 'string' },
		'discord-username': { type: 'string' },
		'linkedin-id': { type: 'string' },
		'linkedin-slug': { type: 'string' },
		unlink: { type: 'string' },
	},
});
const who = positionals[0];
if (!who || (values.unlink && !['discord', 'linkedin', 'github'].includes(values.unlink))) {
	console.error('usage: npm run sse:link -- <email | SSE user id> [--discord-id ID] [--discord-username NAME] [--linkedin-id SUB] [--linkedin-slug URL] | --unlink discord|linkedin|github');
	process.exit(1);
}

const prisma = createPrisma();
try {
	const member = /^\d+$/.test(who) ? await prisma.sseMember.findFirst({ where: { id: Number(who), removedAt: null } }) : await sseMemberForEmail(prisma, who);
	if (!member) throw new Error(`no SSE member ${who} (has the sync run?)`);
	if (values.unlink) await unlinkAccount(prisma, member.id, ({ discord: 'discordId', linkedin: 'linkedInId', github: 'gitHubLinkedId' } as const)[values.unlink as 'discord']);
	else
		await linkManually(prisma, member.id, {
			discordId: values['discord-id'],
			discordUsername: values['discord-username'],
			linkedInId: values['linkedin-id'],
			linkedInSlug: values['linkedin-slug'],
		});
	const m = await prisma.sseMember.findUniqueOrThrow({ where: { id: member.id } });
	console.log(`${m.name} <${m.email}> (SSE user ${m.id})`);
	console.log(`  Discord:  id ${m.discordId ?? '-'}, username ${m.discordUsername ?? '-'}${m.discordLinkedVia ? ` (${m.discordLinkedVia})` : ''}`);
	console.log(`  LinkedIn: id ${m.linkedInId ?? '-'}${m.linkedInLinkedVia ? ` (${m.linkedInLinkedVia})` : ''}, slug ${m.resolvedLinkedIn ?? '-'}${m.linkedInSlugManual ? ' (manual)' : ''}`);
	console.log(`  GitHub:   id ${m.gitHubLinkedId ?? '-'}, username ${m.gitHubLinkedLogin ?? '-'}${m.gitHubLinkedVia ? ` (${m.gitHubLinkedVia})` : ''}, profile ${m.resolvedGitHub ?? m.gitHubGiven ?? '-'}`);
} catch (e) {
	console.error((e as Error).message);
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
