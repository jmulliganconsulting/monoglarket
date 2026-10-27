import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { IMAGE_NAME, IMAGE_TYPE } from '../../../visuals/images.ts';

/** Market and outcome pictures. Signed-in members only (hooks), like the SSE pictures. */
export async function GET({ params }) {
	if (!IMAGE_NAME.test(params.file)) error(404); // also blocks path traversal
	const bytes = await readFile(join(DATA_DIR, 'market-images', params.file)).catch(() => error(404));
	return new Response(bytes, {
		headers: { 'content-type': IMAGE_TYPE[params.file.split('.')[1]], 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
	});
}
