// Admin: mirror the SSE site's alumni list (/api/alumni) into sse_alumni. Safe to run again; listings that vanish get removedAt.
//   npm run sse:alumni
import { createPrisma } from '../src/db/db.ts';
import { sseMemberForEmail } from '../src/sse/accounts.ts';

type SseAlumnus = {
	id: number;
	name: string;
	email: string;
	linkedIn: string | null;
	gitHub: string | null;
	description: string | null;
	imageKey: string | null;
	start_date: string;
	end_date: string;
	quote: string | null;
	previous_roles: string | null;
};

const baseUrl = process.env.SSE_API_URL;
if (!baseUrl) {
	console.error('SSE_API_URL is not set (see .env.example)');
	process.exit(1);
}

const prisma = createPrisma();
try {
	const res = await fetch(`${baseUrl}/alumni`);
	if (!res.ok) throw new Error(`SSE /api/alumni: HTTP ${res.status}`);
	const list = (await res.json()) as SseAlumnus[];

	const now = new Date();
	for (const a of list) {
		const memberId = (await sseMemberForEmail(prisma, a.email))?.id ?? null;
		const row = {
			memberId,
			name: a.name,
			email: a.email,
			linkedIn: a.linkedIn || null,
			gitHub: a.gitHub || null,
			description: a.description || null,
			imageKey: a.imageKey || null,
			startDate: a.start_date,
			endDate: a.end_date,
			quote: a.quote || null,
			previousRoles: a.previous_roles || null,
			lastSeenAt: now,
			removedAt: null,
		};
		await prisma.sseAlumni.upsert({ where: { id: a.id }, create: { id: a.id, ...row }, update: row });
	}

	const gone = await prisma.sseAlumni.updateMany({
		where: { id: { notIn: list.map((a) => a.id) }, removedAt: null },
		data: { removedAt: now },
	});
	console.log(`SSE alumni: ${list.length} listed, ${gone.count} no longer listed`);
} catch (e) {
	console.error((e as Error).message);
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
