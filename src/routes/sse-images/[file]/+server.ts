import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { IMAGE_FILE } from '../../../sse/resolve.ts';

const TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };

/** Saved SSE profile pictures and event images (sse_members.image_file, sse_events.image_file). Names are content hashes, so they never change. Signed-in members only (hooks). */
export async function GET({ params }) {
	if (!IMAGE_FILE.test(params.file)) error(404); // also blocks path traversal
	const bytes = await readFile(join(DATA_DIR, 'sse-images', params.file)).catch(() => error(404));
	return new Response(bytes, {
		headers: { 'content-type': TYPE[params.file.split('.')[1]], 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
	});
}
