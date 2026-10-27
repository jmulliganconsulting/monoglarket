import { error, fail, redirect } from '@sveltejs/kit';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/db.ts';
import { isModerator } from '../../../../auth/roles.ts';
import { saveMarketImage } from '../../../../visuals/images.ts';
import { setAppearance } from '../../../../visuals/appearance.ts';
import { LedgerError } from '../../../../ledger/ledger.ts';
import { marketMessage } from '../../../../markets/messages.ts';

// Moderators set a market's colours and pictures (vault "Market visuals").
export async function load({ params, locals }) {
	if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
	const m = await prisma.market.findUnique({
		where: { id: Number(params.id) },
		select: { id: true, question: true, colorPrimary: true, colorSecondary: true, imageFile: true, outcomes: { where: { removedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, label: true, color: true, imageFile: true } } },
	});
	if (!m) error(404, 'No such market');
	return m;
}

export const actions = {
	default: async ({ request, locals, params }) => {
		if (!isModerator(locals.user!.role)) error(403, 'Moderators only');
		const form = await request.formData();
		const dir = join(DATA_DIR, 'market-images');
		const picture = async (f: FormDataEntryValue | null) => (f instanceof File && f.size > 0 ? saveMarketImage(dir, f) : undefined);
		const outcomeIds = form.getAll('outcomeId').map(Number);
		try {
			await setAppearance(prisma, {
				marketId: Number(params.id),
				moderatorId: locals.user!.id,
				colorPrimary: String(form.get('colorPrimary') ?? ''),
				colorSecondary: String(form.get('colorSecondary') ?? ''),
				image: await picture(form.get('image')),
				outcomes: await Promise.all(outcomeIds.map(async (id) => ({ id, color: String(form.get(`color_${id}`) ?? ''), image: await picture(form.get(`image_${id}`)) }))),
			});
		} catch (e) {
			// Upload problems are plain messages; market problems are codes that markets/messages.ts words.
			const message = e instanceof LedgerError ? marketMessage(e) : e instanceof Error ? e.message : 'Something went wrong. Try again.';
			return fail(400, { error: message });
		}
		redirect(303, `/markets/${params.id}`);
	},
};
