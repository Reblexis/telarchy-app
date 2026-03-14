import { memo, useMemo, useState, useEffect } from 'react';
import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';
import { useDarkMode } from '../hooks/useDarkMode';

function parseDateToMs(str: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str).getTime();
  if (/^\d{4}-W\d{2}$/.test(str)) {
    const year = parseInt(str.slice(0, 4));
    const week = parseInt(str.slice(6));
    const jan4 = new Date(year, 0, 4);
    const dow = jan4.getDay() || 7;
    const d = new Date(jan4);
    d.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
    return d.getTime();
  }
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [y, m] = str.split('-').map(Number);
    return new Date(y, m - 1, 1).getTime();
  }
  return new Date(parseInt(str), 0, 1).getTime();
}

function fmtYears(years: number): string {
  const abs = Math.abs(years);
  const sign = years < 0 ? '-' : '';
  if (abs < 1 / 52) return `${sign}${Math.round(abs * 365)}d`;
  if (abs < 1 / 12) return `${sign}${Math.round(abs * 52)}w`;
  if (abs < 1) return `${sign}${Math.round(abs * 12)}mo`;
  return `${sign}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)}y`;
}

function TimePreferenceSparkline({ halfLife }: { halfLife: number }) {
  const W = 60, H = 28;
  const padL = 1, padR = 1, padT = 1, padB = 9;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const axisY = padT + plotH;

  const pts = Array.from({ length: 25 }, (_, i) => {
    const t = (i / 24) * 10;
    const weight = Math.exp((-Math.LN2 / halfLife) * t);
    const x = padL + (i / 24) * plotW;
    const y = padT + (1 - weight) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const axisProps = { stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 1 };
  const labelProps = { fill: 'currentColor', fillOpacity: 0.4, fontSize: 7 };

  return (
    <span title={`Time preference: exponential decay, half-life ${halfLife}y`} style={{ marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <line x1={padL} y1={padT} x2={padL} y2={axisY} {...axisProps} />
        <line x1={padL} y1={axisY} x2={padL + plotW} y2={axisY} {...axisProps} />
        <polyline points={pts} fill="none" stroke="var(--accent-color, #3b82f6)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={padL} y={H - 1} textAnchor="start" {...labelProps}>0</text>
        <text x={padL + plotW} y={H - 1} textAnchor="end" {...labelProps}>10y</text>
      </svg>
    </span>
  );
}

const TimeSeriesChart = memo(function TimeSeriesChart({
  timeSeries, currentValue, isDark,
}: {
  timeSeries: Array<{ date: string; value: number }>;
  currentValue: number;
  isDark: boolean;
}) {
  const svg = useMemo(() => {
    const W = 400, H = 110;
    const padL = 36, padR = 8, padT = 6, padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const now = Date.now();
    const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
    const pts = timeSeries.map(p => ({
      xYears: (parseDateToMs(p.date) - now) / MS_PER_YEAR,
      y: p.value,
      date: p.date,
    }));

    const xMin = Math.min(...pts.map(p => p.xYears));
    const xMax = Math.max(...pts.map(p => p.xYears));
    const yMin = Math.min(...pts.map(p => p.y), currentValue);
    const yMax = Math.max(...pts.map(p => p.y), currentValue);
    const yPad = (yMax - yMin) * 0.15 || 1;
    const yLo = yMin - yPad, yHi = yMax + yPad;
    const xRange = xMax - xMin || 1;

    const toSvg = (xYears: number, y: number) => ({
      sx: padL + ((xYears - xMin) / xRange) * plotW,
      sy: padT + (1 - (y - yLo) / (yHi - yLo)) * plotH,
    });

    const svgPts = pts.map(p => toSvg(p.xYears, p.y));
    const polyline = svgPts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');
    const fillPoly = [
      `${svgPts[0].sx.toFixed(1)},${(padT + plotH).toFixed(1)}`,
      ...svgPts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`),
      `${svgPts[svgPts.length - 1].sx.toFixed(1)},${(padT + plotH).toFixed(1)}`,
    ].join(' ');

    const nowSy = padT + (1 - (currentValue - yLo) / (yHi - yLo)) * plotH;

    const yTicks = [yLo + (yHi - yLo) * 0.1, yLo + (yHi - yLo) * 0.5, yLo + (yHi - yLo) * 0.9];
    const step = Math.ceil(pts.length / 5);
    const xTickIdxs = pts.map((_, i) => i).filter(i => i % step === 0);

    const stroke = '#3b82f6';
    const fill = isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)';
    const gridC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    const tickC = isDark ? '#999' : '#777';
    const axisC = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';

    return { W, H, padL, padR, padT, padB, plotW, plotH, polyline, fillPoly, svgPts, pts, yTicks, xTickIdxs, yLo, yHi, nowSy, stroke, fill, gridC, tickC, axisC };
  }, [timeSeries, currentValue, isDark]);

  const { W, H, padL, padT, padB, plotH, plotW, polyline, fillPoly, svgPts, pts, yTicks, xTickIdxs, yLo, yHi, nowSy, stroke, fill, gridC, tickC, axisC } = svg;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const chart = (large: boolean) => (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
      {yTicks.map((y, i) => {
        const sy = padT + (1 - (y - yLo) / (yHi - yLo)) * plotH;
        return <line key={i} x1={padL} y1={sy} x2={padL + plotW} y2={sy} stroke={gridC} strokeWidth="1" />;
      })}
      <polygon points={fillPoly} fill={fill} />
      <polyline points={polyline} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* current value reference line — always visible */}
      <line x1={padL} y1={nowSy} x2={padL + plotW} y2={nowSy} stroke="#f59e0b" strokeWidth={large ? '1.5' : '2'} strokeDasharray="4 3" />
      {svgPts.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r={large ? 4 : 3} fill={stroke} stroke={isDark ? '#1a1a1a' : '#fff'} strokeWidth="1.5">
          <title>{pts[i].date}: {pts[i].y.toFixed(2)}</title>
        </circle>
      ))}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={axisC} strokeWidth="1" />
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={axisC} strokeWidth="1" />
      {yTicks.map((y, i) => {
        const sy = padT + (1 - (y - yLo) / (yHi - yLo)) * plotH;
        return (
          <text key={i} x={padL - 4} y={sy + 3} textAnchor="end" fontSize={large ? '10' : '8'} fill={tickC}>
            {Math.round(y)}
          </text>
        );
      })}
      {xTickIdxs.map(i => (
        <text key={i} x={svgPts[i].sx} y={padT + plotH + padB - 6} textAnchor="middle" fontSize={large ? '10' : '8'} fill={tickC}>
          {fmtYears(pts[i].xYears)}
        </text>
      ))}
    </svg>
  );

  const bg = isDark ? '#1a1a1a' : '#f8f8f8';

  return (
    <>
      <div
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          marginTop: '0.75rem', width: '100%', cursor: 'zoom-in',
          background: bg, borderRadius: '6px', padding: '4px',
          position: 'relative', zIndex: hovered ? 10 : 'auto',
          transform: hovered ? 'scale(2.3)' : 'scale(1)',
          transformOrigin: 'top center',
          transition: 'transform 0.2s ease',
        }}
        title="Click to expand"
      >
        {chart(false)}
      </div>
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: isDark ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: isDark ? '#1e1e1e' : '#fff',
              borderRadius: '8px',
              padding: '1.5rem',
              width: 'min(90vw, 700px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {chart(true)}
            <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
              <button className="btn-small" onClick={() => setExpanded(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

interface MetricCardProps {
  metric: Metric;
  warnings: FormulaWarning[];
  isFocused: boolean;
  onFocus: () => void;
  onGraph: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MetricCard({ metric, warnings, isFocused, onFocus, onGraph, onEdit, onDelete }: MetricCardProps) {
  const isLeaf = !metric.formula || metric.formula === '0';
  const { isDark } = useDarkMode();

  return (
    <div className="metric-card">
      <div className="metric-info">
        <div className="metric-name">
          {metric.name}
          {warnings.length > 0 && (
            <span title={warnings.map(w => w.message).join('\n')} style={{ marginLeft: '0.5rem', color: 'var(--error-text)', cursor: 'help' }}>!</span>
          )}
        </div>
        {metric.description && (
          <div className="metric-stats" style={{ marginBottom: '0.25rem', fontStyle: 'italic' }}>
            {metric.description}
          </div>
        )}
        <div className="metric-stats">
          {isLeaf ? `Value: ${metric.value.toFixed(2)}` : `Total: ${metric.total.toFixed(2)}`}
          {!isLeaf && metric.baselineTotal !== undefined && (() => {
            const delta = metric.total - metric.baselineTotal;
            if (Math.abs(delta) < 0.005) return null;
            return (
              <span style={{ marginLeft: '0.5rem', color: delta > 0 ? '#22c55e' : '#ef4444', fontSize: '0.85em', fontWeight: 600 }}>
                {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>
                  (was {metric.baselineTotal.toFixed(2)})
                </span>
              </span>
            );
          })()}
          {metric.timePreference?.enabled && (
            <TimePreferenceSparkline halfLife={metric.timePreference.halfLife} />
          )}
        </div>
        {!isLeaf && (
          <details style={{ marginTop: '0.5rem' }}>
            <summary>Formula</summary>
            <div>{metric.formula}</div>
          </details>
        )}
        {warnings.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ color: 'var(--error-text)', marginTop: '0.2rem' }}>
                {w.message}
              </div>
            ))}
          </div>
        )}
        {metric.timeSeries && metric.timeSeries.length > 0 && (
          <div style={{ marginLeft: '-1rem', marginRight: '-140px' }}>
            <TimeSeriesChart
              timeSeries={metric.timeSeries}
              currentValue={isLeaf ? metric.value : metric.total}
              isDark={isDark}
            />
          </div>
        )}
      </div>
      <div className="metric-actions">
        <button className={`btn-small btn-focus ${isFocused ? 'active' : ''}`} onClick={onFocus} title="Focus on this metric">
          Zoom
        </button>
        <button className="btn-small" onClick={onGraph}>Graph</button>
        <button className="btn-small" onClick={onEdit}>Edit</button>
        <button className="btn-small btn-delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
