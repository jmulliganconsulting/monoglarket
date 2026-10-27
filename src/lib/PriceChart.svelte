<script lang="ts">
	// Chance over time, one line per series, the way Polymarket draws a date question. Each series steps through its own points.
	type Series = { label: string; color: string; points: { t: number; p: number }[] };
	// `end` is when a closed market stopped trading: the lines stop there. Omitted, they run to now.
	let { series, end = null }: { series: Series[]; end?: Date | null } = $props();
	const endT = $derived(end ? new Date(end).getTime() : null);
	const now = $derived(endT ?? Date.now());

	const W = 600;
	const H = 200;
	const spans = { '1D': 86_400_000, '1W': 7 * 86_400_000, '1M': 30 * 86_400_000, All: Infinity } as const;
	type Range = keyof typeof spans;
	let range = $state<Range>('All');
	let hoverT = $state<number | null>(null);

	// Within the range, each line starts at the chance in force when the range begins, then follows its own trades.
	const visible = $derived(
		series.map((s) => {
			const from = range === 'All' ? -Infinity : now - spans[range];
			let p0 = s.points[0].p;
			for (const pt of s.points) if (pt.t <= from) p0 = pt.p;
			return { ...s, points: [{ t: Math.max(from, s.points[0].t), p: p0 }, ...s.points.filter((pt) => pt.t > from)] };
		}),
	);
	const t0 = $derived(Math.min(...visible.map((s) => s.points[0].t)));
	const t1 = $derived(endT ?? Math.max(Date.now(), ...visible.flatMap((s) => s.points.map((p) => p.t))));
	const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
	const y = (p: number) => H - p * H;
	const paths = $derived(
		visible.map((s) => {
			const last = s.points[s.points.length - 1];
			return [...s.points, { t: t1, p: last.p }].map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(' ');
		}),
	);
	const probAt = (s: Series, t: number) => {
		let p = s.points[0].p;
		for (const pt of s.points) if (pt.t <= t) p = pt.p;
		return p;
	};
	const pct = (p: number) => `${Math.round(p * 100)}%`;
	const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

	const onHover = (e: PointerEvent) => {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		hoverT = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0);
	};
</script>

<div class="chart">
	<div class="ranges" role="group" aria-label="Time range">
		{#each Object.keys(spans) as r (r)}
			<button type="button" class:on={range === r} onclick={() => (range = r as Range)}>{r}</button>
		{/each}
	</div>
	<div class="plot">
		<svg viewBox="0 0 {W} {H}" role="img" aria-label="Chance of each option over time" preserveAspectRatio="none" onpointermove={onHover} onpointerdown={onHover} onpointerleave={() => (hoverT = null)}>
		{#each [0.25, 0.5, 0.75] as g (g)}
			<line x1="0" x2={W} y1={y(g)} y2={y(g)} class="grid" />
		{/each}
		{#each paths as d, i (i)}
			<path {d} fill="none" stroke={visible[i].color} stroke-width="2.5" vector-effect="non-scaling-stroke" />
		{/each}
		{#if hoverT !== null}
			<line x1={x(hoverT)} x2={x(hoverT)} y1="0" y2={H} class="cursor" />
			{#each series as s (s.label)}
				<circle cx={x(hoverT)} cy={y(probAt(s, hoverT))} r="4" fill={s.color} />
			{/each}
		{/if}
	</svg>
		{#if hoverT !== null}
			<div class="tip" class:flip={x(hoverT) / W > 0.6} style:left="{(x(hoverT) / W) * 100}%">
				<p class="meta">{when(hoverT)}</p>
				<ul>
					{#each series as s (s.label)}
						<li><span class="swatch" style:background={s.color}></span>{s.label}<strong>{pct(probAt(s, hoverT))}</strong></li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
	<p class="meta readout" aria-live="polite">{hoverT === null ? 'Move across the chart to see the chance at any time.' : when(hoverT)}</p>
	<ul class="legend">
		{#each series as s (s.label)}
			<li>
				<span class="swatch" style:background={s.color}></span>
				{s.label} <strong>{pct(hoverT === null ? s.points[s.points.length - 1].p : probAt(s, hoverT))}</strong>
			</li>
		{/each}
	</ul>
</div>

<style>
	.chart {
		display: grid;
		gap: 8px;
	}
	.ranges {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}
	.ranges button {
		min-height: 44px;
		min-width: 44px;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.ranges button.on {
		color: var(--fg);
		font-weight: var(--weight-strong);
		background: var(--card-2);
	}
	svg {
		width: 100%;
		height: 200px;
		display: block;
		touch-action: none;
	}
	.plot {
		position: relative;
	}
	/* Floats over the chart at the hovered moment: the time and every option's chance then. */
	.tip {
		position: absolute;
		top: 8px;
		transform: translateX(12px);
		min-width: 180px;
		padding: 8px 12px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow-card);
		font-size: 0.8125rem;
		pointer-events: none;
	}
	.tip.flip {
		transform: translateX(calc(-100% - 12px));
	}
	.tip p {
		margin: 0 0 4px;
	}
	.tip ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.tip li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tip strong {
		margin-left: auto;
		padding-left: 12px;
		font-variant-numeric: tabular-nums;
	}
	.grid {
		stroke: var(--border);
		stroke-dasharray: 2 4;
		vector-effect: non-scaling-stroke;
	}
	.cursor {
		stroke: var(--muted);
		vector-effect: non-scaling-stroke;
	}
	.readout {
		margin: 0;
		font-size: 0.8125rem;
	}
	.legend {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		font-size: 0.875rem;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}
	.meta {
		color: var(--muted);
	}
</style>
