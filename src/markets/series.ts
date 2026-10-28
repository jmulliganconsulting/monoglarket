// Price history per outcome: starts at the uniform opening price, then one point per trade (the chart's data).
export function priceSeries(
	outcomes: { id: number; label: string }[],
	trades: { outcomeId: number; probAfter: number; createdAt: Date }[],
	start: Date,
) {
	return outcomes.map((o) => ({
		label: o.label,
		points: [{ t: start.getTime(), p: 1 / outcomes.length }, ...trades.filter((t) => t.outcomeId === o.id).map((t) => ({ t: t.createdAt.getTime(), p: t.probAfter }))],
	}));
}
