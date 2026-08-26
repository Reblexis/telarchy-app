import type { ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * The prediction, visualized: the market's call over the market's lifetime,
 * Manifold-style. One series only, because the page is about one thing: what
 * the market currently believes and how it got there. Consensus is piecewise
 * constant between trades, so the line steps; every step is someone's trade.
 * It ends at the current call, marked with a dot and the value.
 *
 * Deliberately NOT here: the metric's own history (that is the past of the
 * measured thing, not the market), future zones, second series. The x domain
 * runs from the first trade to now; the settle date is a caption under the
 * chart, not chart space.
 *
 * Hand-rolled SVG: brand control (bone/amber, mono numerals), no library,
 * crosshair via pointer events so touch works.
 */

interface Props {
  series: Array<{ at: string; consensus: number | null }>;
  consensus: number;
  /** Currency prefix for every numeral ('$' or ''), inferred by the caller. */
  unit?: string;
  /** Which range words to offer, by key ('1D', '1W', ...); all when absent. */
  ranges?: string[];
  /** The view toggle words, rendered at the left of the range row. */
  corner?: ReactNode;
  /** Top-left corner note ("resolves 31 December 2026"): the one market
      fact that belongs on the visualization itself. */
  note?: string;
  /** A composed-but-unplaced bet's impact: where the call would move. Drawn
      as a dashed ghost off the live dot, tinted by direction. */
  preview?: { value: number; direction: 'higher' | 'lower' } | null;
  /** The viewer's own resting limit orders, drawn as faint rules at their
      limits. Seeing your order sitting in the price is what makes the
      abstraction concrete, and it costs one line each. */
  orders?: Array<{ id: string; direction: 'higher' | 'lower'; limitValue: number }>;
  /** The other branch of a conditional pair, drawn as a second, quieter
      line (owner decision 2026-08-10: both branches on the page, the gap
      between them IS the priced impact). `tone` colours it; the primary
      series stays the loud one. */
  secondary?: {
    series: Array<{ at: string; consensus: number | null }>;
    consensus: number;
    label: string;
    tone: 'higher' | 'lower';
  } | null;
  height?: number;
}

// Two geometries for one chart: the wide 720-unit canvas reads well from
// ~520 CSS px up; below that the svg scales down until its type is
// illegible, so phones get a narrower, taller canvas instead of a shrunken
// copy of the desktop one. Tracked live via matchMedia so window resizes
// and orientation changes swap geometry instead of leaving a squished
// chart behind.
const GEOM = {
  wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
  compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
};
const PAD_T = 16;
const PAD_B = 24;

function compactNum(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * The smallest difference two y-axis labels can express at this magnitude,
 * given compactNum's formatting. Used as the floor on the axis span: an axis
 * narrower than a few of these prints the same number twice and turns noise
 * into a cliff.
 */
function labelQuantum(v: number): number {
  const abs = Math.abs(v);
  if (abs >= 1000) return 100; // "77.4k": one tenth of a thousand
  if (abs >= 1) return 1; // "25": whole units
  return 0.01; // sub-unit values, where the guard must not flatten a real move
}

function fullNum(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// The zoom row, Manifold-style: fixed windows ending now. A window longer
// than the market's whole life is greyed out, like Manifold (owner
// decision 2026-08-10, after trying both: an enabled window over a
// younger market drew a near-empty axis, which read worse than a dimmed
// button). Enabled windows pin the axis to [now - range, now].
const RANGES: Array<{ key: string; ms: number }> = [
  { key: '1H', ms: 3600e3 },
  { key: '6H', ms: 6 * 3600e3 },
  { key: '1D', ms: 24 * 3600e3 },
  { key: '1W', ms: 7 * 24 * 3600e3 },
  { key: '1M', ms: 30 * 24 * 3600e3 },
];

export function MarketChart({
  series,
  consensus,
  unit = '',
  note,
  preview = null,
  orders = [],
  secondary = null,
  height,
  ranges,
  corner,
}: Props) {
  // The range words a caller allows (docs/ui-conventions.md: the market view
  // offers 1D 1W ALL); undefined keeps the full set for older callers.
  const rangeSet = ranges ? RANGES.filter(r => ranges.includes(r.key)) : RANGES;
  const [range, setRange] = useState<number | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 520);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 519px)');
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const { W, PAD_L, PAD_R, H: geomH } = GEOM[compact ? 'compact' : 'wide'];
  const H = height ?? geomH;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // Per-instance ids for the gradient and the plot clip. They used to be
  // global ("mchart-plot"), and the chart is keyed by market id, so switching
  // job or branch mounts the new chart while the old one is still in the DOM:
  // both carry the same id, url(#...) resolves to whichever comes first, and
  // when that one unmounts the reference dangles and everything inside the
  // clipped group stops painting for a frame. That is the flash the owner saw
  // (reported 2026-08-12).
  const uid = useId().replace(/:/g, '');
  const fillId = `mchart-fill-${uid}`;
  const clipId = `mchart-plot-${uid}`;

  const model = useMemo(() => {
    let pts = series
      .filter(p => p.consensus !== null)
      .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
      .filter(p => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (pts.length === 0) return null;
    const now = Date.now();
    const fullSpan = now - pts[0].t;
    if (range !== null) {
      const cutoff = now - range;
      // The call in force AT the window's left edge, so the step line
      // enters the window at its true level instead of starting mid-air.
      // A market younger than the window keeps all its points and the line
      // simply starts mid-window: the WINDOW defines the axis (fixed
      // below), never the data, or 1H on a young market looks identical
      // to ALL and the whole row reads as dead (owner report 2026-08-10).
      const carried = [...pts].reverse().find(p => p.t <= cutoff);
      const inside = pts.filter(p => p.t > cutoff);
      pts = carried ? [{ t: cutoff, v: carried.v }, ...inside] : inside;
      if (pts.length === 0) pts = [{ t: now, v: consensus }];
    }
    // The secondary branch shares the domain: two lines are only comparable
    // when they share axes, and the gap between them is the point.
    let secPts = (secondary?.series ?? [])
      .filter(p => p.consensus !== null)
      .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
      .filter(p => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (range !== null && secPts.length > 0) {
      const cutoff = now - range;
      const carried = [...secPts].reverse().find(p => p.t <= cutoff);
      const inside = secPts.filter(p => p.t > cutoff);
      secPts = carried ? [{ t: cutoff, v: carried.v }, ...inside] : inside;
    }

    // A selected window pins the axis to [now - range, now] regardless of
    // where the data starts; ALL spans the data. The right edge is always
    // max(now, newest point), NEVER the future: the 60-second minimum span
    // (the guard against a zero-width axis on a single-trade market) extends
    // the window LEFT. It used to extend right, which put dead future space
    // after the live dot, labeled ticks with times that had not happened
    // yet, and stranded the primary line mid-chart while the secondary drew
    // to the domain edge (owner report 2026-08-13).
    const t1 = Math.max(now, pts[pts.length - 1].t);
    const t0 = range !== null ? now - range : Math.min(pts[0].t, secPts[0]?.t ?? pts[0].t, t1 - 60_000);
    const span = t1 - t0;

    // In ALL mode the step line enters the window at the call in force at
    // its left edge (t0 precedes the first point when the other branch is
    // older, or when the minimum span extended the window left), so an
    // untraded branch (one fallback point at now) draws as a flat held-call
    // line instead of a floating dot. Zoom windows keep their deliberate
    // mid-window start (2026-08-10: the window defines the axis, not the
    // data). The call also holds since the last trade: extend to the edge.
    const lead = range === null && pts[0].t > t0 ? [{ t: t0, v: pts[0].v }] : [];
    const extended = [...lead, ...pts, { t: t1, v: consensus }];
    // Two kinds of value feed the y domain. The SERIES is what the market
    // printed over time; in a thin market a single trade can saturate the AMM
    // and print at the metric's ceiling for one tick, and taking a raw
    // min/max over that stretches the axis until every real move is a flat
    // line (observed live 2026-08-12: a $10k..$180k axis for a market that
    // spent its life between $73k and $77k). So the series contributes a
    // ROBUST band (5th..95th percentile); brief excursions still draw, they
    // are simply clipped to the plot instead of rescaling everything.
    const seriesValues = extended.map(p => p.v);
    if (secondary) for (const p of secPts) seriesValues.push(p.v);
    // MUST-SHOW values are single facts the reader needs on the canvas: the
    // live call, a composed bet's ghost, resting orders, the other branch.
    // These always widen the domain, never get clipped.
    const mustShow: number[] = [consensus];
    if (preview) mustShow.push(preview.value);
    for (const o of orders) mustShow.push(o.limitValue);
    if (secondary) mustShow.push(secondary.consensus);

    const sorted = [...seriesValues].sort((a, b) => a - b);
    const quantile = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
    const vMin0 = Math.min(quantile(0.05), ...mustShow);
    const vMax0 = Math.max(quantile(0.95), ...mustShow);
    const vPad = (vMax0 - vMin0 || vMax0 * 0.08 || 1) * 0.25;
    let vMin = Math.max(0, vMin0 - vPad);
    let vMax = vMax0 + vPad;

    // The axis must be wide enough that its own labels can tell its top from
    // its bottom. Without this, a market that moved 25 -> 25.07 -> 25 drew a
    // full-height cliff between two ticks both reading "25" (owner report
    // 2026-08-15: "it goes from 25 to 25 and yet it goes down?"), because
    // scaling to the data alone amplifies a 0.3% move to the whole canvas.
    // The floor is four label quanta: enough for the axis to print at least
    // two distinct ticks. It sits far below any real move (LookPilot's 5k
    // swing labels in hundreds, so its floor is 400), so this only ever
    // catches noise.
    const minSpan = labelQuantum(Math.max(Math.abs(vMin0), Math.abs(vMax0))) * 4;
    if (vMax - vMin < minSpan) {
      const mid = (vMin0 + vMax0) / 2;
      vMin = Math.max(0, mid - minSpan / 2);
      // Re-derive the top from the clamped bottom, so clamping at zero
      // narrows the window instead of preserving it.
      vMax = vMin + minSpan;
    }

    const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);

    // Step path: hold each value until the next trade changes it.
    let d = `M${x(extended[0].t).toFixed(1)},${y(extended[0].v).toFixed(1)}`;
    for (let i = 1; i < extended.length; i++) {
      d += ` L${x(extended[i].t).toFixed(1)},${y(extended[i - 1].v).toFixed(1)}`;
      d += ` L${x(extended[i].t).toFixed(1)},${y(extended[i].v).toFixed(1)}`;
    }
    const end = extended[extended.length - 1];
    const areaPath = `${d} L${x(end.t).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(extended[0].t).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

    let secD: string | null = null;
    let secEnd: { t: number; v: number } | null = null;
    if (secondary) {
      // Same entry rule as the primary: in ALL mode the quiet line starts
      // at the window's left edge holding its first value.
      const secLead = range === null && secPts.length > 0 && secPts[0].t > t0 ? [{ t: t0, v: secPts[0].v }] : [];
      const sec =
        secPts.length > 0
          ? [...secLead, ...secPts, { t: t1, v: secondary.consensus }]
          : [
              { t: t0, v: secondary.consensus },
              { t: t1, v: secondary.consensus },
            ];
      secD = `M${x(sec[0].t).toFixed(1)},${y(sec[0].v).toFixed(1)}`;
      for (let i = 1; i < sec.length; i++) {
        secD += ` L${x(sec[i].t).toFixed(1)},${y(sec[i - 1].v).toFixed(1)}`;
        secD += ` L${x(sec[i].t).toFixed(1)},${y(sec[i].v).toFixed(1)}`;
      }
      secEnd = sec[sec.length - 1];
    }

    // Round-number gridlines.
    const rawStep = (vMax - vMin) / 4;
    const mag = 10 ** Math.floor(Math.log10(rawStep || 1));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(sv => sv >= rawStep) ?? rawStep;
    const gridVals: number[] = [];
    for (let v = Math.ceil(vMin / step) * step; v < vMax; v += step) {
      if (v > vMin + (vMax - vMin) * 0.04 && v < vMax - (vMax - vMin) * 0.04) gridVals.push(v);
    }

    // Time ticks: ~4, labeled by how long the market has lived. Inside two
    // days the label is a clock time, but a bare "08:26" is ambiguous once the
    // window crosses midnight, so the date rides along when it does.
    const crossesDay = new Date(t0).toDateString() !== new Date(t0 + span).toDateString();
    const fmt = (t: number) => {
      const dt = new Date(t);
      if (span >= 48 * 3600e3) return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      // Under ten minutes, four minute-resolution ticks all print the same
      // minute; seconds keep them distinct.
      const time = dt.toLocaleTimeString(
        'en-US',
        span < 600e3
          ? { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false }
          : { hour: 'numeric', minute: '2-digit', hour12: false },
      );
      return crossesDay ? `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}` : time;
    };
    const ticks = [0.08, 0.38, 0.68, 0.95].map(f => t0 + f * span);

    return {
      pts,
      extended,
      d,
      areaPath,
      end,
      secD,
      secEnd,
      t0,
      t1,
      span,
      fullSpan,
      x,
      y,
      gridVals,
      ticks,
      fmt,
      open: extended[0],
    };
  }, [series, consensus, preview, orders, secondary, range, H, W, PAD_L, PAD_R]);

  // A window wider than the market's whole life falls back to ALL. This used
  // to run during render, which is a state update mid-render and forces React
  // to throw the pass away and redo it - visible as a stutter while the
  // pointer is moving. It belongs in an effect.
  const fullSpan = model?.fullSpan;
  useEffect(() => {
    if (range !== null && fullSpan !== undefined && range >= fullSpan) setRange(null);
  }, [range, fullSpan]);

  // The crosshair follows the pointer, but pointermove fires far faster than
  // the screen refreshes (120Hz+ on a trackpad), and every event re-rendered
  // the whole SVG. Coalesce to one update per frame.
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  if (!model) return null;
  const { extended, d, areaPath, end, secD, secEnd, x, y, gridVals, ticks, fmt } = model;
  const cNum = (v: number) => `${unit}${compactNum(v)}`;
  const fNum = (v: number) => `${unit}${fullNum(v)}`;
  // The call and ghost labels live at the right edge; when a label is too
  // wide for the remaining canvas (dollar values usually are), anchor it on
  // the left side of its dot instead of letting it run off the edge.
  // 6.8 units/char approximates the 11px mono glyph width.
  const edgeLabel = (dotX: number, text: string) =>
    dotX + 9 + text.length * 6.8 <= W
      ? { x: dotX + 9, anchor: 'start' as const }
      : { x: dotX - 9, anchor: 'end' as const };

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Map the pointer through the plot area, not the whole svg: the x scale
    // spans [PAD_L, W - PAD_R], so treating the full width as the time axis
    // would land the crosshair closer to center than the mouse.
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (mouseX - PAD_L) / (W - PAD_L - PAD_R);
    pendingRef.current = model.t0 + Math.max(0, Math.min(1, frac)) * model.span;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingRef.current !== null) setCursor(pendingRef.current);
    });
  };

  const onLeave = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    setCursor(null);
  };

  // The call in force at a moment = the last step at or before it.
  const valueAt = (t: number) => {
    let v = extended[0].v;
    for (const p of extended) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  };
  const tipX = cursor !== null ? x(cursor) : 0;
  const tipRight = cursor !== null && tipX > W * 0.6;

  return (
    <div className="mchart">
      <div className="mchart-ranges" role="group" aria-label="Time range">
        {note && <span className="mchart-note">{note}</span>}
        {corner && <span className="mchart-corner mchart-corner--inline">{corner}</span>}
        {rangeSet.map(r => (
          <button
            key={r.key}
            className={`mchart-range${range === r.ms ? ' is-active' : ''}`}
            disabled={r.ms >= model.fullSpan}
            aria-pressed={range === r.ms}
            onClick={() => setRange(cur => (cur === r.ms ? null : r.ms))}
          >
            {r.key}
          </button>
        ))}
        <button
          className={`mchart-range${range === null ? ' is-active' : ''}`}
          aria-pressed={range === null}
          onClick={() => setRange(null)}
        >
          ALL
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        role="img"
        aria-label={`The market's call over time, currently ${fNum(consensus)}`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            {/* currentColor inside <defs> resolves against the svg root, not
                the referencing group, so name the accent explicitly. */}
            <stop offset="0%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0.14" />
            <stop offset="100%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0" />
          </linearGradient>
          {/* The y domain is robust (see the model), so a saturated tick can
              exceed it. Clip the drawn series to the plot rectangle: the line
              runs off the edge, which reads as "it spiked past here", instead
              of overprinting the axis labels. Horizontally the rect is padded
              4 units per side: the step to the live call lands exactly ON the
              plot's right edge, and a vertical stroke centered on the clip
              boundary loses half its width (owner report 2026-08-13: the
              vertical segment drew thinner than the horizontal run). */}
          <clipPath id={clipId}>
            <rect x={PAD_L - 4} y={PAD_T} width={W - PAD_L - PAD_R + 8} height={H - PAD_T - PAD_B} />
          </clipPath>
        </defs>

        {gridVals.map(v => (
          <g key={v}>
            <line className="mchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(v) + 3}>
              {cNum(v)}
            </text>
          </g>
        ))}

        {ticks.map(t => (
          <text key={t} className="mchart-xlabel" x={x(t)} y={H - 8}>
            {fmt(t)}
          </text>
        ))}

        {secondary &&
          secD &&
          secEnd &&
          (() => {
            // Keep the two end labels apart when the branches sit close.
            const py = y(secEnd.v);
            const cy0 = y(end.v);
            const labelY = Math.abs(py - cy0) < 15 ? py + (py >= cy0 ? 15 : -15) : py;
            const text = `${fNum(secondary.consensus)} ${secondary.label}`;
            const lb = edgeLabel(x(secEnd.t), text);
            return (
              <g className={`mchart-branch mchart-branch--${secondary.tone}`}>
                <path d={secD} className="mchart-branch-line" clipPath={`url(#${clipId})`} />
                <circle cx={x(secEnd.t)} cy={py} r="3.5" className="mchart-branch-dot" />
                <text className="mchart-branch-label" x={lb.x} y={labelY + 4} textAnchor={lb.anchor}>
                  {text}
                </text>
              </g>
            );
          })()}

        <g className="mchart-market">
          <g clipPath={`url(#${clipId})`}>
            <path d={areaPath} className="mchart-fill-area" fill={`url(#${fillId})`} stroke="none" />
            {/* pathLength=1 normalizes the dash math so the entrance draw
                (stroke-dashoffset 1 -> 0 in CSS) works for any path. */}
            <path d={d} className="mchart-mline" pathLength={1} />
          </g>
          <circle cx={x(end.t)} cy={y(end.v)} r="5" className="mchart-callhalo" />
          <circle cx={x(end.t)} cy={y(end.v)} r="5" className="mchart-calldot" />
          {(() => {
            const lb = edgeLabel(x(end.t), fNum(consensus));
            return (
              <text className="mchart-calllabel" x={lb.x} y={y(end.v) + 4} textAnchor={lb.anchor}>
                {fNum(consensus)}
              </text>
            );
          })()}
        </g>

        {orders.map(o => (
          <g key={o.id} className={`mchart-order mchart-order--${o.direction}`}>
            <line className="mchart-order-line" x1={PAD_L} x2={W - PAD_R} y1={y(o.limitValue)} y2={y(o.limitValue)} />
            <text className="mchart-order-label" x={PAD_L + 4} y={y(o.limitValue) - 4}>
              {o.direction === 'higher' ? '▲' : '▼'} your order {cNum(o.limitValue)}
            </text>
          </g>
        ))}

        {preview &&
          (() => {
            const py = y(preview.value);
            const cy0 = y(end.v);
            // Keep the ghost label clear of the live call label on tiny moves.
            const labelY = Math.abs(py - cy0) < 15 ? cy0 + (preview.direction === 'higher' ? -15 : 15) : py;
            const text = `${preview.direction === 'higher' ? '▲' : '▼'} ${fNum(preview.value)}`;
            const lb = edgeLabel(x(end.t), text);
            return (
              <g className={`mchart-ghost mchart-ghost--${preview.direction}`}>
                <line className="mchart-ghost-line" x1={x(end.t)} x2={x(end.t)} y1={cy0} y2={py} />
                <circle className="mchart-ghost-dot" cx={x(end.t)} cy={py} r="4.5" />
                <text className="mchart-ghost-label" x={lb.x} y={labelY + 4} textAnchor={lb.anchor}>
                  {text}
                </text>
              </g>
            );
          })()}

        {cursor !== null && (
          <g className="mchart-cross">
            <line x1={tipX} x2={tipX} y1={PAD_T} y2={H - PAD_B} />
            <circle cx={tipX} cy={y(valueAt(cursor))} r="3.5" className="mchart-cross-mkt" />
          </g>
        )}
      </svg>

      {cursor !== null && (
        <div className={`mchart-tip${tipRight ? ' is-right' : ''}`} style={{ left: `${(tipX / W) * 100}%` }}>
          <div className="mchart-tip-date">{fmt(cursor)}</div>
          <div>
            market <span className="mchart-tip-v mchart-tip-v--mkt">{fNum(valueAt(cursor))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
