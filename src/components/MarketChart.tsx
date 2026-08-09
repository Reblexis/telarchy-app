import { useEffect, useMemo, useRef, useState } from 'react';

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
  /** A composed-but-unplaced bet's impact: where the call would move. Drawn
      as a dashed ghost off the live dot, tinted by direction. */
  preview?: { value: number; direction: 'higher' | 'lower' } | null;
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

function fullNum(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function MarketChart({ series, consensus, unit = '', preview = null, height }: Props) {
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

  const model = useMemo(() => {
    const pts = series
      .filter(p => p.consensus !== null)
      .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
      .filter(p => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (pts.length === 0) return null;
    const now = Date.now();
    // The call holds between trades and since the last one: extend to now.
    const extended = [...pts, { t: Math.max(now, pts[pts.length - 1].t), v: consensus }];

    const t0 = extended[0].t;
    const t1 = extended[extended.length - 1].t;
    const span = Math.max(t1 - t0, 60_000);
    const values = extended.map(p => p.v);
    if (preview) values.push(preview.value);
    const vMin0 = Math.min(...values);
    const vMax0 = Math.max(...values);
    const vPad = (vMax0 - vMin0 || vMax0 * 0.08 || 1) * 0.25;
    const vMin = Math.max(0, vMin0 - vPad);
    const vMax = vMax0 + vPad;

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
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(sv => sv >= rawStep) ?? rawStep;
    const gridVals: number[] = [];
    for (let v = Math.ceil(vMin / step) * step; v < vMax; v += step) {
      if (v > vMin + (vMax - vMin) * 0.04 && v < vMax - (vMax - vMin) * 0.04) gridVals.push(v);
    }

    // Time ticks: ~4, labeled by how long the market has lived.
    const fmt = (t: number) => span < 48 * 3600e3
      ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })
      : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const ticks = [0.08, 0.38, 0.68, 0.95].map(f => t0 + f * span);

    return { pts, extended, d, areaPath, end, t0, t1: t0 + span, span, x, y, gridVals, ticks, fmt, open: extended[0] };
  }, [series, consensus, preview, H, W, PAD_L, PAD_R]);

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
    setCursor(model.t0 + Math.max(0, Math.min(1, frac)) * model.span);
  };

  // The call in force at a moment = the last step at or before it.
  const valueAt = (t: number) => {
    let v = extended[0].v;
    for (const p of extended) { if (p.t <= t) v = p.v; else break; }
    return v;
  };
  const tipX = cursor !== null ? x(cursor) : 0;
  const tipRight = cursor !== null && tipX > W * 0.6;

  return (
    <div className="mchart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
        role="img"
        aria-label={`The market's call over time, currently ${fNum(consensus)}`}
      >
        <defs>
          <linearGradient id="mchart-fill" x1="0" y1="0" x2="0" y2="1">
            {/* currentColor inside <defs> resolves against the svg root, not
                the referencing group, so name the accent explicitly. */}
            <stop offset="0%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0.14" />
            <stop offset="100%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridVals.map(v => (
          <g key={v}>
            <line className="mchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(v) + 3}>{cNum(v)}</text>
          </g>
        ))}

        {ticks.map(t => (
          <text key={t} className="mchart-xlabel" x={x(t)} y={H - 8}>{fmt(t)}</text>
        ))}

        <g className="mchart-market">
          <path d={areaPath} className="mchart-fill-area" fill="url(#mchart-fill)" stroke="none" />
          {/* pathLength=1 normalizes the dash math so the entrance draw
              (stroke-dashoffset 1 -> 0 in CSS) works for any path. */}
          <path d={d} className="mchart-mline" pathLength={1} />
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

        {preview && (() => {
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
          <div>market <span className="mchart-tip-v mchart-tip-v--mkt">{fNum(valueAt(cursor))}</span></div>
        </div>
      )}
    </div>
  );
}
