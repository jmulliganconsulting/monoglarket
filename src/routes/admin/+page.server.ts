import { coins } from '#lib/format.ts';
import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/db.ts';
import { grantResolver, MarketError, revokeResolver } from '../../markets/markets.ts';
import { marketMessage } from '../../markets/messages.ts';
import { endBreak, liftBlock, userMessage } from '../../users/users.ts';
import { adjustBalance } from '../../users/adjust.ts';
import { addToGroup, createGroup, removeFromGroup } from '../../groups/groups.ts';
import { getNumberSetting, setSetting } from '../../settings/settings.ts';

// Admin only. Deliberately separate from /moderate and /resolve: a member trusted with one market never sees this page.
function adminId(locals: App.Locals): number {
	if (locals.user?.role !== 'admin') error(403, 'Admins only');
	return locals.user.id;
}

const message = (e: unknown) => (e instanceof MarketError ? marketMessage(e) : userMessage(e));

export async function load({ locals }) {
	adminId(locals);
	const now = new Date();
	const [blocks, breaks, grants, markets] = await Promise.all([
		prisma.signupBlock.findMany({ where: { unblockedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 }),
		prisma.user.findMany({ where: { breakUntil: { gt: now } }, orderBy: { breakUntil: 'asc' }, select: { id: true, displayName: true, username: true, breakUntil: true } }),
		prisma.marketResolver.findMany({
			orderBy: { createdAt: 'desc' },
			include: { market: { select: { id: true, question: true, status: true } }, user: { select: { displayName: true, username: true } } },
		}),
		prisma.market.findMany({ where: { status: { in: ['pending_review', 'open', 'closed'] } }, orderBy: { closeAt: 'asc' }, select: { id: true, question: true, status: true } }),
	]);
	const categories = await prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }], select: { id: true, key: true, name: true, sort: true, color: true } });
	const currencies = await prisma.currency.findMany({ where: { kind: 'internal', active: true }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
	const adjustments = await prisma.balanceAdjustment.findMany({
		orderBy: { createdAt: 'desc' },
		take: 50,
		include: { user: { select: { displayName: true, username: true } }, actor: { select: { displayName: true } }, currency: { select: { code: true } } },
	});
	const seasons = await prisma.season.findMany({ orderBy: { startsAt: 'desc' }, take: 10, select: { id: true, name: true, startsAt: true } });
	const groups = await prisma.userGroup.findMany({
		orderBy: { name: 'asc' },
		include: { members: { include: { user: { select: { id: true, displayName: true, username: true } } }, orderBy: { userId: 'asc' } } },
	});
	const decidedHours = await getNumberSetting(prisma, 'decided_home_hours');
	return {
		decidedHours,
		groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members.map((m) => ({ id: m.user.id, name: m.user.username ? `@${m.user.username}` : m.user.displayName })) })),
		currencies,
		seasons,
		allowances: currencies.map((c) => ({ id: c.id, code: c.code })),
		adjustments: adjustments.map((a) => ({ id: a.id, who: a.user.username ? `@${a.user.username}` : a.user.displayName, amount: a.amount, currency: a.currency.code, reasonPrivate: a.reasonPrivate, reasonPublic: a.reasonPublic, actor: a.actor.displayName, createdAt: a.createdAt })),
		blocks: blocks.map((b) => ({ id: b.id, email: b.email, reason: b.reason, createdAt: b.createdAt })),
		breaks,
		grants: grants.map((g) => ({ id: g.id, marketId: g.market.id, question: g.market.question, status: g.market.status, who: g.user.username ? `@${g.user.username}` : g.user.displayName })),
		markets,
		categories,
	};
}

export const actions = {
	liftBlock: async ({ request, locals }) => {
		const admin = adminId(locals);
		try {
			await liftBlock(prisma, admin, Number((await request.formData()).get('blockId')));
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Block lifted. They can sign in and go through the screens again.' };
	},
	endBreak: async ({ request, locals }) => {
		const admin = adminId(locals);
		try {
			await endBreak(prisma, admin, Number((await request.formData()).get('userId')));
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Break ended. Trading is open again.' };
	},
	grant: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const who = String(form.get('who') ?? '').trim();
		const user = who
			? await prisma.user.findFirst({ where: { OR: [{ username: who.replace(/^@/, '').toLowerCase() }, { email: who }] }, select: { id: true } })
			: null;
		if (!user) return fail(400, { error: 'No member has that username or email.' });
		try {
			await grantResolver(prisma, { marketId: Number(form.get('marketId')), userId: user.id, adminId: admin });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Granted. They can resolve that market on the Resolve page.' };
	},
	adjust: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const who = String(form.get('who') ?? '').trim();
		const magnitude = Number(form.get('amount'));
		const amount = form.get('mode') === 'remove' ? -magnitude : magnitude;
		const user = who ? await prisma.user.findFirst({ where: { OR: [{ username: who.replace(/^@/, '').toLowerCase() }, { email: who }] }, select: { id: true } }) : null;
		if (!user) return fail(400, { error: 'No member has that username or email.' });
		try {
			await adjustBalance(prisma, {
				adminId: admin,
				userId: user.id,
				currencyId: Number(form.get('currencyId')),
				amount,
				reasonPrivate: String(form.get('reasonPrivate') ?? ''),
				reasonPublic: String(form.get('reasonPublic') ?? ''),
				key: String(form.get('key') ?? ''),
			});
		} catch (e) {
			return fail(400, { error: userMessage(e) });
		}
		return { done: `${amount > 0 ? 'Added' : 'Removed'} ${coins(magnitude)}. The member sees the public reason, if you gave one.` };
	},
	addSeason: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim().slice(0, 60);
		const raw = String(form.get('startsAt') ?? '');
		const startsAt = raw ? new Date(raw) : new Date();
		if (!name) return fail(400, { error: 'Name the season.' });
		if (Number.isNaN(startsAt.getTime())) return fail(400, { error: 'Pick a valid start time.' });
		const season = await prisma.season.create({ data: { name, startsAt } });
		await prisma.auditEntry.create({ data: { actorId: admin, action: 'season', detail: `${name} from ${startsAt.toISOString()}` } });
		return { done: `Started ${season.name}. Profit on the leaderboard counts from now.` };
	},
	setAllowance: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const amount = Number(form.get('amount'));
		if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000) return fail(400, { error: 'The weekly allowance is a whole number from 0 to 100,000.' });
		const currency = await prisma.currency.update({ where: { id: Number(form.get('currencyId')) }, data: { weeklyAllowance: amount } });
		await prisma.auditEntry.create({ data: { actorId: admin, action: 'allowance', detail: `${currency.code} weekly ${amount}` } });
		return { done: `Weekly allowance for ${currency.code} is now ${amount}.` };
	},
	setDecidedHours: async ({ request, locals }) => {
		const admin = adminId(locals);
		const hours = Number((await request.formData()).get('hours'));
		if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 365) return fail(400, { error: 'Enter whole hours from 0 to 8,760.' });
		await setSetting(prisma, 'decided_home_hours', String(hours), admin);
		return { done: `Resolved markets now stay on the home page for ${hours} hours. Automated ones leave at once.` };
	},
	createGroup: async ({ request, locals }) => {
		const admin = adminId(locals);
		try {
			await createGroup(prisma, { adminId: admin, name: String((await request.formData()).get('name') ?? '') });
		} catch (e) {
			return fail(400, { error: userMessage(e) });
		}
		return { done: 'Group created.' };
	},
	addToGroup: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const who = String(form.get('who') ?? '').trim();
		const user = who ? await prisma.user.findFirst({ where: { OR: [{ username: who.replace(/^@/, '').toLowerCase() }, { email: who }] }, select: { id: true } }) : null;
		if (!user) return fail(400, { error: 'No member has that username or email.' });
		try {
			await addToGroup(prisma, { adminId: admin, groupId: Number(form.get('groupId')), userId: user.id });
		} catch (e) {
			return fail(400, { error: userMessage(e) });
		}
		return { done: 'Added to the group.' };
	},
	removeFromGroup: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		await removeFromGroup(prisma, { adminId: admin, groupId: Number(form.get('groupId')), userId: Number(form.get('userId')) });
		return { done: 'Removed from the group.' };
	},
	addCategory: async ({ request, locals }) => {
		const admin = adminId(locals);
		const name = String((await request.formData()).get('name') ?? '').trim().slice(0, 40);
		const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		if (!key) return fail(400, { error: 'Give the category a name.' });
		const count = await prisma.category.count();
		try {
			await prisma.category.create({ data: { key, name, sort: count + 1 } });
			await prisma.auditEntry.create({ data: { actorId: admin, action: 'category', detail: name } });
		} catch {
			return fail(400, { error: 'That category already exists.' });
		}
		return { done: `Added ${name}.` };
	},
	// Places set in one save: the tabs on the home page follow this order (lowest first).
	setCategoryOrder: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const categories = await prisma.category.findMany({ select: { id: true } });
		const places = categories.map((c) => {
			const raw = String(form.get(`sort-${c.id}`) ?? '').trim();
			return { id: c.id, sort: raw === '' ? NaN : Number(raw) };
		});
		if (places.some((p) => !Number.isInteger(p.sort))) return fail(400, { error: 'Each category needs a whole number for its place.' });
		await prisma.$transaction(places.map((p) => prisma.category.update({ where: { id: p.id }, data: { sort: p.sort } })));
		await prisma.auditEntry.create({ data: { actorId: admin, action: 'category', detail: 'Changed the category order' } });
		return { done: 'Category order saved.' };
	},
	// Each tab's colour (#rrggbb). Empty = the default button colour.
	setCategoryColours: async ({ request, locals }) => {
		const admin = adminId(locals);
		const form = await request.formData();
		const categories = await prisma.category.findMany({ select: { id: true } });
		const colours = categories.map((c) => ({ id: c.id, color: String(form.get(`colour-${c.id}`) ?? '').trim().toLowerCase() }));
		if (colours.some((c) => c.color !== '' && !/^#[0-9a-f]{6}$/.test(c.color))) return fail(400, { error: 'A colour is #rrggbb, like #3b82f6.' });
		await prisma.$transaction(colours.map((c) => prisma.category.update({ where: { id: c.id }, data: { color: c.color || null } })));
		await prisma.auditEntry.create({ data: { actorId: admin, action: 'category', detail: 'Changed the category colours' } });
		return { done: 'Category colours saved.' };
	},
	revoke: async ({ request, locals }) => {
		const admin = adminId(locals);
		try {
			await revokeResolver(prisma, { grantId: Number((await request.formData()).get('grantId')), adminId: admin });
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { done: 'Revoked.' };
	},
};
