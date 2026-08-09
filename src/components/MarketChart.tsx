import { useMemo, useRef, useState } from 'react';

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
  height?: number;
}

// Two geometries for one chart: the wide 720-unit canvas reads well from
// ~520 CSS px up; below that the svg scales down until its type is
// illegible, so phones get a narrower, taller canvas instead of a shrunken
// copy of the desktop one. Chosen once at mount (orientation changes are
// rare and a reload fixes them).
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

export function MarketChart({ series, consensus, height }: Props) {
  const [compact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 520);
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
  }, [series, consensus, H, W, PAD_L, PAD_R]);

  if (!model) return null;
  const { extended, d, areaPath, end, x, y, gridVals, ticks, fmt } = model;

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
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
        aria-label={`The market's call over time, currently ${fullNum(consensus)}`}
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
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(v) + 3}>{compactNum(v)}</text>
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
          <text className="mchart-calllabel" x={x(end.t) + 9} y={y(end.v) + 4} textAnchor="start">
            {fullNum(consensus)}
          </text>
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
          <div>market <span className="mchart-tip-v mchart-tip-v--mkt">{fullNum(valueAt(cursor))}</span></div>
        </div>
      )}
    </div>
  );
}
