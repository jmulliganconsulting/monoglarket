// Pictures for markets and outcomes (vault "Market visuals"). Uploads are checked by type and by file signature,
// saved under a random name, and served only by the market-images route.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_IMAGE_BYTES = 2_000_000;
/** File names we wrote: a UUID and an extension. Anything else is refused before it reaches the disk. */
export const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
export const IMAGE_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const KIND: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function looksLike(bytes: Buffer, ext: string) {
  if (ext === 'png') return bytes.subarray(0, 4).toString('hex') === '89504e47';
  if (ext === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

/** Saves an uploaded picture and returns its file name. Throws a plain Error with a message for the member. */
export async function saveMarketImage(dir: string, file: File): Promise<string> {
  const ext = KIND[file.type];
  if (!ext) throw new Error('Pictures must be PNG, JPEG or WebP.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Pictures must be 2 MB or smaller.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLike(bytes, ext)) throw new Error('That file is not a picture.');
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, name), bytes);
  return name;
}
