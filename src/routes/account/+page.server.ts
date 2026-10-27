import { fail } from '@sveltejs/kit';
import { setPassword } from '../../auth/auth.ts';
import { prisma } from '#lib/server/db.ts';
import { discordApp, gitHubEnabled, linkedInEnabled, SESSION_COOKIE } from '#lib/server/session.ts';
import { disconnectAccount, sseMemberForEmail } from '../../sse/accounts.ts';
import { unlinkDiscord } from '../../sse/discord.ts';
import { messageFor } from '../login/messages.ts';
import { startBreak, userMessage } from '../../users/users.ts';
import { isMonthDay, removeBirthday, setBirthday } from '../../users/birthday.ts';

export async function load({ locals }) {
	const member = locals.user!.email ? await sseMemberForEmail(prisma, locals.user!.email) : null;
	return {
		email: locals.user!.email,
		hasPassword: !!locals.user!.passwordHash,
		linkedIn: { enabled: linkedInEnabled, onSse: !!member, connected: !!member?.linkedInId },
		gitHub: {
			enabled: gitHubEnabled,
			onSse: !!member,
			login: member?.gitHubLinkedId ? member.gitHubLinkedLogin : null,
			// The username typed on the SSE profile, when it isn't the account they connected.
			profileMismatch: member?.gitHubLinkedId && member.gitHubGiven && member.gitHubLinkedId !== String(member.gitHubId) ? member.gitHubGiven : null,
		},
		until: locals.user!.breakUntil,
		birthday: locals.user!.birthdaySetAt ? { month: locals.user!.birthMonth, day: locals.user!.birthDay } : null,
		birthdayRemoved: !!locals.user!.birthdayRemovedAt,
		discord: { enabled: !!discordApp, onSse: !!member, username: member?.discordId ? member.discordUsername ?? member.discordId : null },
	};
}

export const actions = {
	password: async ({ request, cookies, locals }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		if (password !== form.get('confirm')) return fail(400, { error: "The passwords don't match." });
		try {
			await setPassword(prisma, locals.user!.id, password, cookies.get(SESSION_COOKIE));
		} catch (e) {
			return fail(400, { error: messageFor(e) });
		}
		return { saved: true };
	},
	break: async ({ request, locals }) => {
		try {
			await startBreak(prisma, locals.user!.id, String((await request.formData()).get('length')));
		} catch (e) {
			return fail(400, { breakError: userMessage(e) });
		}
		return { breakStarted: true };
	},
	birthday: async ({ request, locals }) => {
		const form = await request.formData();
		// Nothing is saved unless the rewards box is ticked (vault "Birthday").
		if (form.get('birthdayRewards') !== 'on') return fail(400, { birthdayError: 'Tick the box if you want birthday rewards. Nothing was saved.' });
		const month = Number(form.get('birthMonth'));
		const day = Number(form.get('birthDay'));
		if (!Number.isInteger(month) || !Number.isInteger(day) || !isMonthDay(month, day)) return fail(400, { birthdayError: 'Enter a real month and day.' });
		try {
			await setBirthday(prisma, locals.user!.id, { month, day });
		} catch (e) {
			return fail(400, { birthdayError: userMessage(e) });
		}
		return { birthdaySaved: true };
	},
	removeBirthday: async ({ locals }) => {
		try {
			await removeBirthday(prisma, locals.user!.id);
		} catch (e) {
			return fail(400, { birthdayError: userMessage(e) });
		}
		return { birthdayRemoved: true };
	},
	disconnectLinkedIn: async ({ locals }) => {
		if (locals.user!.email) await disconnectAccount(prisma, locals.user!.email, 'linkedInId');
		return { disconnected: true };
	},
	disconnectGitHub: async ({ locals }) => {
		if (locals.user!.email) await disconnectAccount(prisma, locals.user!.email, 'gitHubLinkedId');
		return { gitHubDisconnected: true };
	},
	disconnectDiscord: async ({ locals }) => {
		if (discordApp && locals.user!.email) await unlinkDiscord(prisma, discordApp, locals.user!.email);
		return { discordDisconnected: true };
	},
};
