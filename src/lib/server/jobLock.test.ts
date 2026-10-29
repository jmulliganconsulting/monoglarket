import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testPrisma } from '../../test-db.ts';
import { withJobLock } from './jobLock.ts';

test('a second copy of a job skips while the first holds the lock', async () => {
	const { prisma, drop } = await testPrisma();
	try {
		let runs = 0;
		let finish!: () => void;
		const first = withJobLock(prisma, 'test-job', () => {
			runs++;
			return new Promise<void>((resolve) => (finish = resolve));
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		await withJobLock(prisma, 'test-job', async () => {
			runs++;
		});
		finish();
		await first;
		assert.equal(runs, 1);

		await withJobLock(prisma, 'test-job', async () => {
			runs++;
		});
		assert.equal(runs, 2);
	} finally {
		await drop();
	}
});
