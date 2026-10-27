// Admin: run one SSE site sync now, instead of waiting for the 15-minute timer in hooks.server.ts. Uses the same settings as the server:
//   npm run sse:sync
import { join } from 'node:path';
import { createPrisma } from '../src/db/db.ts';
import { syncSse } from '../src/sse/sync.ts';

const baseUrl = process.env.SSE_API_URL;
if (!baseUrl) {
	console.error('SSE_API_URL is not set (see .env.example)');
	process.exit(1);
}

const prisma = createPrisma();
try {
	const r = await syncSse(prisma, {
		baseUrl,
		imageDir: join(process.env.DATA_DIR ?? 'data', 'sse-images'),
		ritApiKey: process.env.RIT_API_KEY,
		gitHubToken: process.env.GITHUB_TOKEN,
	});
	console.log(`SSE sync: ${r.members} users, ${r.officers} active officer positions (${r.officerRoles} all-time), ${r.mentors} mentors, ${r.profilesFetched} profiles read, ${r.events} events, ${r.attendanceFetched} attendance lists (${r.checkins} check-ins); ${r.gitHubChecked} GitHub checks, ${r.imagesSaved} pictures saved, ${r.imagesFailed} failed`);
} catch (e) {
	console.error((e as Error).message);
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
