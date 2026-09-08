import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { labelQuantum, yDomain } from '../lib/chart-domain';

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
  height?: number;
  /** Ink instead of amber: for a series that is not a market's call (the
   *  profile's balance, docs/ui-conventions.md "The participant profile"). */
  tone?: 'market' | 'ink';
  /** The word the tooltip and the aria-label use for the series. */
  label?: string;
}

// Two geometries for one chart: the wide 720-unit canvas reads well from
// ~520 CSS px up; below that the svg scales down until its type is
// illegible, so phones get a narrower, taller canvas instead of a shrunken
// copy of the desktop one. Tracked live via matchMedia so window resizes
// and orientation changes swap geometry instead of leaving a squished
// chart behind.
/** Shared with NumberChart, so both views of the chart slot have one geometry. */
export const GEOM = {
  wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
  compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
};
const PAD_T = 16;
const PAD_B = 24;

export function compactNum(v: number): string {
  const abs = Math.abs(v);
  // Millions and billions get their own tier: a $10M valuation axis once
  // printed "$10,000k" (owner report 2026-08-28).
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** The y-axis label quantum lives with the domain helper (lib/chart-domain);
 *  re-exported here for the callers that always found it on the chart. */
export { labelQuantum };

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
  height,
  ranges,
  tone = 'market',
  label = 'market',
}: Props) {
  const ink = tone === 'ink';
  const seriesName = label === 'market' ? "The market's call" : `The ${label}`;
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
    // A selected window pins the axis to [now - range, now] regardless of
    // where the data starts; ALL spans the data. The right edge is always
    // max(now, newest point), NEVER the future: the 60-second minimum span
    // (the guard against a zero-width axis on a single-trade market) extends
    // the window LEFT. It used to extend right, which put dead future space
    // after the live dot, labeled ticks with times that had not happened
    // yet, and stranded the primary line mid-chart while the secondary drew
    // to the domain edge (owner report 2026-08-13).
    const t1 = Math.max(now, pts[pts.length - 1].t);
    const t0 = range !== null ? now - range : Math.min(pts[0].t, t1 - 60_000);
    const span = t1 - t0;

    // In ALL mode the step line enters the window at the call in force at
    // its left edge (t0 precedes the first point when the minimum span
    // extended the window left), so a market with one point draws as a flat
    // held-call line instead of a floating dot. Zoom windows keep their deliberate
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
    // The live call is a single fact the reader needs on the canvas: it
    // always widens the domain, never gets clipped.
    const mustShow: number[] = [consensus];

    // The domain itself is lib/chart-domain's, shared with the floor's stake
    // example so the verbs quote the axis the reader sees.
    const { lo: vMin, hi: vMax } = yDomain(seriesValues, mustShow);

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
  }, [series, consensus, range, H, W, PAD_L, PAD_R]);

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
  const { extended, d, areaPath, end, x, y, gridVals, ticks, fmt } = model;
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
    <div className={`mchart${ink ? ' mchart--ink' : ''}`}>
      <div className="mchart-ranges" role="group" aria-label="Time range">
        <span className="mchart-left" />
        <span className="mchart-center" />
        <span className="mchart-right">
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
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        role="img"
        aria-label={`${seriesName} over time, currently ${fNum(consensus)}`}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            {/* currentColor inside <defs> resolves against the svg root, not
                the referencing group, so name the accent explicitly. */}
            <stop offset="0%" style={{ stopColor: ink ? 'var(--text-primary)' : 'var(--accent)' }} stopOpacity="0.14" />
            <stop offset="100%" style={{ stopColor: ink ? 'var(--text-primary)' : 'var(--accent)' }} stopOpacity="0" />
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
            const text = fNum(consensus);
            const lb = edgeLabel(x(end.t), text);
            return (
              <text className="mchart-calllabel" x={lb.x} y={y(end.v) + 4} textAnchor={lb.anchor}>
                {text}
              </text>
            );
          })()}
        </g>

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
            {label} <span className="mchart-tip-v mchart-tip-v--mkt">{fNum(valueAt(cursor))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
