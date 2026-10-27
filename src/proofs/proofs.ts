// Proof behind a resolution proposal (vault "Resolution proof"): links, pictures and PDFs. Files are checked by type and
// by file signature, saved under a random name, and served only by the /proofs route, which checks who can see the market.
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_PROOF_BYTES = 5_000_000;
export const MAX_PROOFS = 5;
export const PROOF_TYPES = 'image/png,image/jpeg,image/webp,application/pdf';
/** File names we wrote: a UUID and an extension. Anything else is refused before it reaches the disk. */
export const PROOF_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;

const KIND: Record<string, { ext: string; kind: 'image' | 'file' }> = {
	'image/png': { ext: 'png', kind: 'image' },
	'image/jpeg': { ext: 'jpg', kind: 'image' },
	'image/webp': { ext: 'webp', kind: 'image' },
	'application/pdf': { ext: 'pdf', kind: 'file' },
};

export type ProofInput =
	| { kind: 'link'; url: string; label: string }
	| { kind: 'image' | 'file'; storedName: string; originalName: string; mimeType: string; sizeBytes: number; label: string };

export function looksLikeProof(bytes: Buffer, ext: string): boolean {
	if (ext === 'png') return bytes.subarray(0, 4).toString('hex') === '89504e47';
	if (ext === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8;
	if (ext === 'webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
	return bytes.subarray(0, 4).toString() === '%PDF';
}

/** Saves one uploaded picture or PDF. Throws a plain Error with a message for the member. */
export async function saveProof(dir: string, file: File): Promise<ProofInput> {
	const spec = KIND[file.type];
	if (!spec) throw new Error('Proof files must be PNG, JPEG, WebP or PDF.');
	if (file.size > MAX_PROOF_BYTES) throw new Error('Proof files must be 5 MB or smaller.');
	const bytes = Buffer.from(await file.arrayBuffer());
	if (!looksLikeProof(bytes, spec.ext)) throw new Error('That file does not match its type.');
	await mkdir(dir, { recursive: true });
	const storedName = `${randomUUID()}.${spec.ext}`;
	await writeFile(join(dir, storedName), bytes);
	return { kind: spec.kind, storedName, originalName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: bytes.length, label: file.name.slice(0, 80) };
}

/** The links and uploaded pictures or PDFs from a form, saved to dir. Keeps nothing when it throws. */
export async function proofsFromForm(form: FormData, dir: string): Promise<ProofInput[]> {
	const proofs = parseLinks(String(form.get('proofLinks') ?? ''));
	const files = form.getAll('proofFile').filter((f): f is File => f instanceof File && f.size > 0);
	if (proofs.length + files.length > MAX_PROOFS) throw new Error('Attach at most 5 pieces of proof.');
	try {
		for (const file of files) proofs.push(await saveProof(dir, file));
	} catch (e) {
		await discardProofs(dir, proofs);
		throw e;
	}
	return proofs;
}

/** Removes the pictures and PDFs of a refused proposal. Links have nothing on disk. */
export async function discardProofs(dir: string, proofs: ProofInput[]) {
	await Promise.all(proofs.flatMap((p) => (p.kind === 'link' ? [] : [unlink(join(dir, p.storedName)).catch(() => {})])));
}

/** Only https links are kept. Throws for anything else, so a proof can never point at a page the browser would run. */
export function isHttpsUrl(text: string): boolean {
	try {
		return new URL(text).protocol === 'https:';
	} catch {
		return false;
	}
}

/** Lines of "https://address | caption" from the form. The caption is optional. */
export function parseLinks(text: string): ProofInput[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [url, ...rest] = line.split('|');
			const address = url.trim();
			if (!isHttpsUrl(address)) throw new Error('Links must start with https://');
			return { kind: 'link' as const, url: new URL(address).toString(), label: rest.join('|').trim().slice(0, 80) || address };
		});
}
