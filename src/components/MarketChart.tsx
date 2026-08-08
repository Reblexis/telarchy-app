import { useMemo, useRef, useState } from 'react';

/**
 * The trading floor's centerpiece: one financial chart carrying the whole
 * story. Two series share one canvas because the product IS their
 * relationship: the ink line is reality (the metric's synced history), the
 * amber line is the market's call as it moved with every trade, and the
 * dashed reach into the shaded future zone ends at the settle dot, the number
 * the market currently believes. A stranger reads it with no legend text
 * beyond two swatches: it's been growing, it's here now, the market says
 * there next month. Agreeing or disagreeing with the dot is the trade.
 *
 * Hand-rolled SVG: full control of the brand (bone/ink/amber, mono numerals),
 * no chart library, crosshair via pointer events so it works with touch.
 */

export interface ChartPoint { at: string; value: number }

interface Props {
  history: ChartPoint[];
  marketHistory: Array<{ at: string; consensus: number | null }>;
  consensus: number;
  resolvesOn: string;
  height?: number;
}

const W = 720;
const PAD_L = 46;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 24;

function compactNum(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fullNum(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function monthLabel(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short' });
}

export function MarketChart({ history, marketHistory, consensus, resolvesOn, height = 280 }: Props) {
  const H = height;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // time under pointer

  const model = useMemo(() => {
    const hist = history.map(p => ({ t: new Date(p.at).getTime(), v: p.value }))
      .filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    const mkt = marketHistory
      .filter(p => p.consensus !== null)
      .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus as number }))
      .filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    const settleT = new Date(resolvesOn).getTime();
    const now = Date.now();
    if (hist.length < 2 || !Number.isFinite(settleT)) return null;

    const t0 = Math.min(hist[0].t, mkt[0]?.t ?? Infinity);
    const t1 = settleT + (settleT - t0) * 0.03;
    const values = [...hist.map(p => p.v), ...mkt.map(p => p.v), consensus];
    const vMin0 = Math.min(...values);
    const vMax0 = Math.max(...values);
    const vPad = (vMax0 - vMin0 || vMax0 * 0.1 || 1) * 0.12;
    const vMin = Math.max(0, vMin0 - vPad);
    const vMax = vMax0 + vPad;

    const x = (t: number) => PAD_L + ((t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);

    const line = (pts: Array<{ t: number; v: number }>) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

    const histPath = line(hist);
    const lastHist = hist[hist.length - 1];
    const areaPath = `${histPath} L${x(lastHist.t).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(hist[0].t).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

    // The market line starts where the market started; the dashed segment
    // carries the CURRENT call from the last trade (or from now) to the dot.
    const mktPath = mkt.length >= 2 ? line(mkt) : '';
    const dashFrom = mkt.length > 0 ? mkt[mkt.length - 1] : { t: Math.min(now, settleT), v: consensus };

    // Y gridlines on round numbers: pick a clean step (1/2/2.5/5 x 10^k)
    // near a quarter of the domain, then draw the multiples that fall inside.
    const rawStep = (vMax - vMin) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(sv => sv >= rawStep) ?? rawStep;
    const gridVals: number[] = [];
    for (let v = Math.ceil(vMin / step) * step; v < vMax; v += step) {
      if (v > vMin + (vMax - vMin) * 0.03 && v < vMax - (vMax - vMin) * 0.03) gridVals.push(v);
    }

    // X ticks: month starts within domain.
    const ticks: number[] = [];
    const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() < t1) { ticks.push(d.getTime()); d.setMonth(d.getMonth() + 1); }

    return { hist, mkt, histPath, areaPath, mktPath, dashFrom, settleT, now: Math.min(now, settleT), t0, t1, vMin, vMax, x, y, gridVals, ticks, lastHist };
  }, [history, marketHistory, consensus, resolvesOn, H]);

  if (!model) return null;
  const { hist, mkt, histPath, areaPath, mktPath, dashFrom, settleT, now, x, y, gridVals, ticks, lastHist } = model;

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const t = model.t0 + frac * (model.t1 - model.t0);
    setCursor(Math.max(model.t0, Math.min(model.t1, t)));
  };

  // Nearest readings under the crosshair.
  const nearest = (pts: Array<{ t: number; v: number }>, t: number) => {
    if (pts.length === 0) return null;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return Math.abs(best.t - t) < (model.t1 - model.t0) * 0.08 ? best : null;
  };
  const curHist = cursor !== null ? nearest(hist, cursor) : null;
  const curMkt = cursor !== null ? nearest(mkt, cursor) : null;
  const tipX = cursor !== null ? x(cursor) : 0;
  const tipRight = cursor !== null && tipX > W * 0.62;

  return (
    <div className="mchart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
        role="img"
        aria-label={`Real value history and the market's call, settling at ${fullNum(consensus)}`}
      >
        <defs>
          <linearGradient id="mchart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* future zone */}
        <rect className="mchart-future" x={x(now)} y={PAD_T} width={Math.max(0, x(model.t1) - x(now))} height={H - PAD_T - PAD_B} />

        {/* gridlines + y labels */}
        {gridVals.map(v => (
          <g key={v}>
            <line className="mchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(v) + 3}>{compactNum(v)}</text>
          </g>
        ))}

        {/* x ticks */}
        {ticks.map(t => (
          <text key={t} className="mchart-xlabel" x={x(t)} y={H - 8}>{monthLabel(t)}</text>
        ))}

        {/* reality: area + line */}
        <g className="mchart-real">
          <path d={areaPath} fill="url(#mchart-fill)" stroke="none" />
          <path d={histPath} className="mchart-line" />
          <circle cx={x(lastHist.t)} cy={y(lastHist.v)} r="3" className="mchart-nowdot" />
        </g>

        {/* the market's call: solid where it traded, dashed to the settle dot */}
        <g className="mchart-market">
          {mktPath && <path d={mktPath} className="mchart-mline" />}
          <path
            d={`M${x(dashFrom.t).toFixed(1)},${y(dashFrom.v).toFixed(1)} L${x(settleT).toFixed(1)},${y(consensus).toFixed(1)}`}
            className="mchart-dash"
          />
          <circle cx={x(settleT)} cy={y(consensus)} r="5" className="mchart-calldot" />
          <text className="mchart-calllabel" x={x(settleT) - 8} y={y(consensus) - 10} textAnchor="end">
            {fullNum(consensus)}
          </text>
        </g>

        {/* crosshair */}
        {cursor !== null && (curHist || curMkt) && (
          <g className="mchart-cross">
            <line x1={tipX} x2={tipX} y1={PAD_T} y2={H - PAD_B} />
            {curHist && <circle cx={x(curHist.t)} cy={y(curHist.v)} r="3.5" className="mchart-cross-real" />}
            {curMkt && <circle cx={x(curMkt.t)} cy={y(curMkt.v)} r="3.5" className="mchart-cross-mkt" />}
          </g>
        )}
      </svg>

      {cursor !== null && (curHist || curMkt) && (
        <div className={`mchart-tip${tipRight ? ' is-right' : ''}`} style={{ left: `${(tipX / W) * 100}%` }}>
          <div className="mchart-tip-date">
            {new Date((curHist ?? curMkt)!.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
          {curHist && <div>real <span className="mchart-tip-v">{fullNum(curHist.v)}</span></div>}
          {curMkt && <div>market <span className="mchart-tip-v mchart-tip-v--mkt">{fullNum(curMkt.v)}</span></div>}
        </div>
      )}

      <div className="mchart-legend">
        <span className="mchart-key mchart-key--real">real value</span>
        <span className="mchart-key mchart-key--mkt">market&rsquo;s call</span>
        <span className="mchart-key mchart-key--settle">◉ settles here</span>
      </div>
    </div>
  );
}
