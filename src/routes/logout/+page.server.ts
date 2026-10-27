import { redirect } from '@sveltejs/kit';
import { signOut } from '../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { SESSION_COOKIE } from '#lib/server/session.ts';

export function load() {
	redirect(303, '/');
}

export const actions = {
	default: async ({ cookies }) => {
		await signOut(prisma, cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	},
};
