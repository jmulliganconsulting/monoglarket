// Text colour that reads on a #rrggbb background: dark on light colours, white on dark ones.
export function textOn(hex: string): string {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#111' : '#fff';
}
