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

<div class="grid gap-2">
	<div class="flex justify-end gap-1" role="group" aria-label="Time range">
		{#each Object.keys(spans) as r (r)}
			<button type="button" class={['min-h-11 min-w-11 cursor-pointer rounded-xl border-0 text-[0.8125rem] [font-family:inherit]', range === r ? 'bg-card-2 font-strong text-fg' : 'bg-transparent text-muted']} onclick={() => (range = r as Range)}>{r}</button>
		{/each}
	</div>
	<div class="relative">
		<svg class="block h-[200px] w-full touch-none" viewBox="0 0 {W} {H}" role="img" aria-label="Chance of each option over time" preserveAspectRatio="none" onpointermove={onHover} onpointerdown={onHover} onpointerleave={() => (hoverT = null)}>
		{#each [0.25, 0.5, 0.75] as g (g)}
			<line x1="0" x2={W} y1={y(g)} y2={y(g)} class="stroke-border [stroke-dasharray:2_4] [vector-effect:non-scaling-stroke]" />
		{/each}
		{#each paths as d, i (i)}
			<path {d} fill="none" stroke={visible[i].color} stroke-width="2.5" vector-effect="non-scaling-stroke" />
		{/each}
		{#if hoverT !== null}
			<line x1={x(hoverT)} x2={x(hoverT)} y1="0" y2={H} class="stroke-muted [vector-effect:non-scaling-stroke]" />
			{#each series as s (s.label)}
				<circle cx={x(hoverT)} cy={y(probAt(s, hoverT))} r="4" fill={s.color} />
			{/each}
		{/if}
	</svg>
		{#if hoverT !== null}
			<!-- Floats over the chart at the hovered moment: the time and every option's chance then. -->
			<div class={['pointer-events-none absolute top-2 min-w-[180px] rounded-xl border border-border bg-card px-3 py-2 text-[0.8125rem] shadow-card', x(hoverT) / W > 0.6 ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3']} style:left="{(x(hoverT) / W) * 100}%">
				<p class="mt-0 mb-1 text-muted">{when(hoverT)}</p>
				<ul class="m-0 grid list-none gap-1 p-0">
					{#each series as s (s.label)}
						<li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style:background={s.color}></span>{s.label}<strong class="ml-auto pl-3 tabular-nums">{pct(probAt(s, hoverT))}</strong></li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
	<p class="m-0 text-[0.8125rem] text-muted" aria-live="polite">{hoverT === null ? 'Move across the chart to see the chance at any time.' : when(hoverT)}</p>
	<ul class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
		{#each series as s (s.label)}
			<li class="inline-flex items-center gap-1.5">
				<span class="inline-block size-2.5 rounded-full" style:background={s.color}></span>
				{s.label} <strong>{pct(hoverT === null ? s.points[s.points.length - 1].p : probAt(s, hoverT))}</strong>
			</li>
		{/each}
	</ul>
</div>

