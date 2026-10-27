import { redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';

// Dismissing the visit summary: it won't show again until the next sign-in.
export function load() {
	redirect(303, '/');
}

export const actions = {
	dismiss: async ({ locals }) => {
		await prisma.user.update({ where: { id: locals.user!.id }, data: { summarySince: null } });
		redirect(303, '/');
	},
};
