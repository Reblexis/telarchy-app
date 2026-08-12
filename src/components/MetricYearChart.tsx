import { useMemo, useRef, useState, useEffect } from 'react';

/**
 * The measured thing, visualized: the hero metric's real trajectory over the
 * calendar year, then a dashed continuation to where the market sees it
 * settling. Sibling of MarketChart and deliberately built the same way (the
 * same hand-rolled SVG, the same `mchart-*` classes, the same bone/amber
 * palette and mono numerals), so the two charts on the floor read as one
 * visual family. The difference is only in what each draws:
 *
 *   MarketChart  - the market's CALL over the market's life, x = trading time,
 *                  one stepped line (consensus is piecewise constant).
 *   MetricYearChart - the METRIC's value over the whole year, x = Jan -> the
 *                  settle date, a solid line for what actually happened and a
 *                  dashed line for the market's forecast to settlement.
 *
 * The x domain is the year, not the trading timeline, which is why this is its
 * own chart rather than a second series on the market chart (their axes differ).
 */

interface Props {
  /** The metric's real values over the year, oldest first. */
  history: Array<{ at: string; value: number }>;
  /** Where the market's consensus sees the metric settling. */
  forecastValue: number;
  /** When it settles (ISO); the dashed line runs to here. */
  forecastAt: string;
  /** Currency prefix for every numeral ('$' or ''), inferred by the caller. */
  unit?: string;
  /** Top-left corner note ("resolves 31 December 2026"). */
  note?: string;
  height?: number;
}

// Same two geometries as MarketChart: a wide desktop canvas and a narrower,
// taller phone canvas, swapped live via matchMedia.
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

export function MetricYearChart({ history, forecastValue, forecastAt, unit = '', note, height }: Props) {
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
    const pts = history
      .map(p => ({ t: new Date(p.at).getTime(), v: p.value }))
      .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (pts.length === 0) return null;
    const forecastT = new Date(forecastAt).getTime();
    const last = pts[pts.length - 1];

    // x domain: the year, from the first real reading to the settle date.
    const t0 = pts[0].t;
    const t1 = Math.max(forecastT, last.t);
    const span = Math.max(t1 - t0, 60_000);

    // y domain: every drawn value, padded, floored at zero (a metric that
    // dips below its axis floor reads as broken, like a negative price).
    const values = pts.map(p => p.v);
    values.push(forecastValue);
    const vMin0 = Math.min(...values);
    const vMax0 = Math.max(...values);
    const vPad = (vMax0 - vMin0 || vMax0 * 0.08 || 1) * 0.25;
    const vMin = Math.max(0, vMin0 - vPad);
    const vMax = vMax0 + vPad;

    const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);

    // The actual line: connect the daily readings (continuous data, so a
    // straight polyline, not the market chart's step).
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L${x(pts[i].t).toFixed(1)},${y(pts[i].v).toFixed(1)}`;
    const areaPath = `${d} L${x(last.t).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(pts[0].t).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

    // The forecast: a dashed segment from where reality ends to the settle
    // target.
    const fcast = `M${x(last.t).toFixed(1)},${y(last.v).toFixed(1)} L${x(forecastT).toFixed(1)},${y(forecastValue).toFixed(1)}`;

    // Round-number gridlines (same maths as the market chart).
    const rawStep = (vMax - vMin) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(sv => sv >= rawStep) ?? rawStep;
    const gridVals: number[] = [];
    for (let v = Math.ceil(vMin / step) * step; v < vMax; v += step) {
      if (v > vMin + (vMax - vMin) * 0.04 && v < vMax - (vMax - vMin) * 0.04) gridVals.push(v);
    }

    // Month ticks across the year: the x-axis IS the months of the year, so
    // label the first of each month that falls inside the domain, thinning to
    // every other month on the narrow canvas.
    const monthTicks: number[] = [];
    const d0 = new Date(t0);
    let my = d0.getUTCFullYear();
    let mm = d0.getUTCMonth();
    const stepMonths = compact ? 2 : 1;
    // Start at the first month boundary at or after t0.
    if (d0.getUTCDate() !== 1) { mm += 1; if (mm > 11) { mm = 0; my += 1; } }
    for (;;) {
      const t = Date.UTC(my, mm, 1);
      if (t > t1) break;
      monthTicks.push(t);
      mm += stepMonths;
      while (mm > 11) { mm -= 12; my += 1; }
    }
    const fmtMonth = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

    // A single combined series for the crosshair, linearly interpolated
    // (continuous data), actual through `last` then the forecast leg.
    const line = [...pts, { t: forecastT, v: forecastValue }];

    return { pts, last, forecastT, d, areaPath, fcast, t0, t1, span, x, y, gridVals, monthTicks, fmtMonth, line, vMin, vMax };
  }, [history, forecastValue, forecastAt, H, W, PAD_L, PAD_R, compact]);

  if (!model) return null;
  const { last, forecastT, d, areaPath, fcast, x, y, gridVals, monthTicks, fmtMonth, line } = model;
  const cNum = (v: number) => `${unit}${compactNum(v)}`;
  const fNum = (v: number) => `${unit}${fullNum(v)}`;
  // Anchor an end label on the left of its dot when it would run off the edge.
  const edgeLabel = (dotX: number, text: string) =>
    dotX + 9 + text.length * 6.8 <= W
      ? { x: dotX + 9, anchor: 'start' as const }
      : { x: dotX - 9, anchor: 'end' as const };

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (mouseX - PAD_L) / (W - PAD_L - PAD_R);
    setCursor(model.t0 + Math.max(0, Math.min(1, frac)) * model.span);
  };

  // Value at a moment: linear interpolation along the combined line.
  const valueAt = (t: number) => {
    if (t <= line[0].t) return line[0].v;
    if (t >= line[line.length - 1].t) return line[line.length - 1].v;
    for (let i = 1; i < line.length; i++) {
      if (t <= line[i].t) {
        const a = line[i - 1];
        const b = line[i];
        const f = (t - a.t) / (b.t - a.t || 1);
        return a.v + f * (b.v - a.v);
      }
    }
    return line[line.length - 1].v;
  };
  const tipX = cursor !== null ? x(cursor) : 0;
  const tipRight = cursor !== null && tipX > W * 0.6;
  const cursorForecast = cursor !== null && cursor > last.t;
  const fcastLabel = edgeLabel(x(forecastT), fNum(forecastValue));

  return (
    <div className="mchart">
      {note && (
        <div className="mchart-ranges" role="group">
          <span className="mchart-note">{note}</span>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
        role="img"
        aria-label={`The metric over the year, currently ${fNum(last.v)}, forecast to settle at ${fNum(forecastValue)}`}
      >
        <defs>
          <linearGradient id="myear-fill" x1="0" y1="0" x2="0" y2="1">
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

        {monthTicks.map(t => (
          <text key={t} className="mchart-xlabel" x={x(t)} y={H - 8}>{fmtMonth(t)}</text>
        ))}

        <g className="mchart-market">
          <path d={areaPath} className="mchart-fill-area" fill="url(#myear-fill)" stroke="none" />
          {/* The forecast leg, dashed, drawn under the solid line's end dot. */}
          <path d={fcast} className="myear-forecast" />
          <path d={d} className="mchart-mline" pathLength={1} />
          {/* Where reality ends: a quiet marker at "now". */}
          <circle cx={x(last.t)} cy={y(last.v)} r="3.5" className="myear-nowdot" />
          {/* The settle target: the live call dot + label, like the market chart. */}
          <circle cx={x(forecastT)} cy={y(forecastValue)} r="5" className="mchart-callhalo" />
          <circle cx={x(forecastT)} cy={y(forecastValue)} r="5" className="mchart-calldot" />
          <text className="mchart-calllabel" x={fcastLabel.x} y={y(forecastValue) + 4} textAnchor={fcastLabel.anchor}>
            {fNum(forecastValue)}
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
          <div className="mchart-tip-date">{new Date(cursor).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
          <div>{cursorForecast ? 'forecast' : 'actual'} <span className="mchart-tip-v mchart-tip-v--mkt">{fNum(valueAt(cursor))}</span></div>
        </div>
      )}
    </div>
  );
}
