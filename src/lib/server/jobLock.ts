import type { PrismaClient } from '../../db/db.ts';

// During a blue/green deploy two app copies run for a moment, and both have timers. The job takes this Postgres lock first; the copy that doesn't get it skips this tick.
// The lock belongs to the open transaction, so the job runs on another pooled connection while the transaction waits. Long enough for the slowest job (SSE sync with pictures).
const LONGEST_JOB_MS = 15 * 60_000;

export async function withJobLock(prisma: PrismaClient, name: string, job: () => Promise<unknown>): Promise<void> {
	await prisma.$transaction(
		async (tx) => {
			const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked`;
			if (locked) await job();
		},
		{ timeout: LONGEST_JOB_MS },
	);
}
