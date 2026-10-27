// Splits a description into plain text and https links, so it can carry links without any HTML.
// The page renders each part as a text node or an anchor, so nothing a member types can inject markup.
export type Part = { text: string; href?: string };

const LINK = /https:\/\/[^\s<>"']+/g;

export function linkify(text: string): Part[] {
	const parts: Part[] = [];
	let last = 0;
	for (const m of text.matchAll(LINK)) {
		const at = m.index ?? 0;
		if (at > last) parts.push({ text: text.slice(last, at) });
		// A full stop or bracket after a link belongs to the sentence, not the link.
		const url = m[0].replace(/[.,;:!?)]+$/, '');
		parts.push({ text: url, href: url });
		if (url.length < m[0].length) parts.push({ text: m[0].slice(url.length) });
		last = at + m[0].length;
	}
	if (last < text.length) parts.push({ text: text.slice(last) });
	return parts;
}
