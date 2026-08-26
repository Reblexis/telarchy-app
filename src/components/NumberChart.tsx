import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * The number view of the floor's chart slot (docs/ui-conventions.md, "The
 * price and the chart"): the metric's own readings as an ink step line up to
 * a "now" rule, and on the future side every open market of this metric as a
 * marker at its settle instant carrying its current call. The view is about
 * the market on screen: its marker is amber and labeled, the others grey, and
 * one beyond the window is a chevron at the edge. The window follows the
 * selected horizon, the range words override it, and a change of window
 * tweens rather than snaps.
 */

export interface NumberPoint {
  at: string;
  value: number;
}

export interface NumberMarker {
  marketId: string;
  /** Settle instant, ISO. */
  resolvesOn: string;
  consensus: number | null;
  selected: boolean;
}

interface Props {
  points: NumberPoint[];
  markers: NumberMarker[];
  /** Settle instant of the market on screen, ISO; the window ends here. */
  selectedResolvesOn: string;
  /** 'day' | 'week' | 'month' | 'other', from the selected market's target date. */
  granularity: Granularity;
  unit?: string;
  /** The words in the top corner (the view toggle), rendered by the caller. */
  corner?: ReactNode;
  now?: Date;
  height?: number;
}

export type Granularity = 'day' | 'week' | 'month' | 'other';

const DAY = 86_400_000;

/** The range words per granularity; the first is the automatic window. */
export const RANGE_WORDS: Record<Granularity, Array<{ key: string; ms: number | null }>> = {
  day: [
    { key: '2D', ms: 2 * DAY },
    { key: '1W', ms: 7 * DAY },
    { key: 'ALL', ms: null },
  ],
  week: [
    { key: '1W', ms: 7 * DAY },
    { key: '1M', ms: 30 * DAY },
    { key: 'ALL', ms: null },
  ],
  month: [
    { key: '1M', ms: 30 * DAY },
    { key: '3M', ms: 90 * DAY },
    { key: 'ALL', ms: null },
  ],
  other: [
    { key: '1M', ms: 30 * DAY },
    { key: '3M', ms: 90 * DAY },
    { key: 'ALL', ms: null },
  ],
};

export function granularityOf(targetDate: string): Granularity {
  if (/^\d{4}-\d{2}-\d{2}(T\d{2})?$/.test(targetDate)) return 'day';
  if (/^\d{4}-W\d{2}$/.test(targetDate)) return 'week';
  if (/^\d{4}-\d{2}$/.test(targetDate)) return 'month';
  return 'other';
}

/**
 * The window a view shows: `span` of readings before now, then the future up
 * to the selected settle instant (plus a hair of padding so the marker is
 * not on the frame). ALL starts at the first reading. Anchored on "now"
 * rather than on the settle instant so a far market still shows the last
 * month of readings instead of an empty month before its date.
 */
export function windowFor(
  selectedResolvesOn: string,
  span: number | null,
  points: NumberPoint[],
  now: Date,
): [number, number] {
  const end = Math.max(new Date(selectedResolvesOn).getTime(), now.getTime());
  const first = points.length > 0 ? new Date(points[0].at).getTime() : now.getTime() - DAY;
  const start = span === null ? Math.min(first, now.getTime() - DAY) : now.getTime() - span;
  const pad = (end - start) * 0.03;
  return [start, end + pad];
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** A tween of the x-domain: the value lags the target by ~400ms, ease-out. */
function useTweenedDomain(target: [number, number]): [number, number] {
  const [dom, setDom] = useState(target);
  const fromRef = useRef(target);
  const targetRef = useRef(target);
  useEffect(() => {
    if (targetRef.current[0] === target[0] && targetRef.current[1] === target[1]) return;
    const from = fromRef.current;
    targetRef.current = target;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      fromRef.current = target;
      setDom(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = easeOut(Math.min(1, (t - t0) / 400));
      const next: [number, number] = [from[0] + (target[0] - from[0]) * k, from[1] + (target[1] - from[1]) * k];
      fromRef.current = next;
      setDom(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target[0], target[1]]);
  return dom;
}

const W = 660;
const PAD_L = 40;
const PAD_R = 22;
const PAD_T = 24;
const PAD_B = 34;

function fmt(v: number, unit: string): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? Math.round(v).toLocaleString('en-US') : abs >= 100 ? v.toFixed(0) : v.toFixed(1);
  return unit + s;
}

function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function NumberChart({
  points,
  markers,
  selectedResolvesOn,
  granularity,
  unit = '',
  corner,
  now = new Date(),
  height = 200,
}: Props) {
  const words = RANGE_WORDS[granularity];
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  // The automatic window is the first range word of the granularity; the
  // key resets when the selected market changes so a new date opens on its
  // own default window.
  useEffect(() => setRangeKey(null), [selectedResolvesOn]);
  const span = (rangeKey ? words.find(w => w.key === rangeKey) : words[0])?.ms ?? null;
  const target = windowFor(selectedResolvesOn, span, points, now);
  const [x0, x1] = useTweenedDomain(target);
  const H = height;
  const x = (t: number) => PAD_L + ((t - x0) / (x1 - x0)) * (W - PAD_L - PAD_R);

  const visible = points.filter(p => {
    const t = new Date(p.at).getTime();
    return t >= x0 && t <= x1;
  });
  // The reading in force at the window's start keeps the line from starting
  // mid-air when the window opens after the first reading.
  const before = points.filter(p => new Date(p.at).getTime() < x0).pop();
  const drawn = before ? [{ at: new Date(x0).toISOString(), value: before.value }, ...visible] : visible;
  const inWindow = markers.filter(m => {
    const t = new Date(m.resolvesOn).getTime();
    return t >= x0 && t <= x1;
  });
  const ys = [...drawn.map(p => p.value), ...inWindow.flatMap(m => (m.consensus === null ? [] : [m.consensus]))];
  const lo = ys.length ? Math.min(...ys) : 0;
  const hi = ys.length ? Math.max(...ys) : 1;
  const span_y = hi - lo || Math.max(1, Math.abs(hi) * 0.2);
  const y0 = lo - span_y * 0.25;
  const y1 = hi + span_y * 0.25;
  const y = (v: number) => PAD_T + (1 - (v - y0) / (y1 - y0)) * (H - PAD_T - PAD_B);
  // Three-ish ticks on round numbers, so the axis reads 5 / 10 / 15 and
  // never 2.5 / 7.5 / 12.4.
  const rawStep = (y1 - y0) / 3;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map(k => k * mag).find(k => k >= rawStep) ?? rawStep;
  const ticks: number[] = [];
  for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) ticks.push(Number(t.toFixed(6)));

  const nowT = now.getTime();
  let d = '';
  drawn.forEach((p, i) => {
    const px = x(new Date(p.at).getTime());
    const py = y(p.value);
    d += i === 0 ? `M${px} ${py}` : ` H${px} V${py}`;
  });
  const last = drawn[drawn.length - 1];
  if (last && nowT > new Date(last.at).getTime()) d += ` H${Math.min(x(nowT), W - PAD_R)}`;

  const beyondLeft = markers.some(m => new Date(m.resolvesOn).getTime() < x0);
  const beyondRight = markers.some(m => new Date(m.resolvesOn).getTime() > x1);

  return (
    <div className="mchart nchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="The number and the market's calls">
        {corner && (
          <foreignObject x={W - 220} y={0} width={220 - PAD_R + 12} height={18}>
            <div className="mchart-corner">{corner}</div>
          </foreignObject>
        )}
        {ticks.map(t => (
          <g key={t}>
            <line className="mchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} />
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(t) + 3}>
              {fmt(t, unit)}
            </text>
          </g>
        ))}
        {nowT >= x0 && nowT <= x1 && (
          <>
            <rect
              className="nchart-future"
              x={x(nowT)}
              y={PAD_T - 6}
              width={Math.max(0, W - PAD_R - x(nowT))}
              height={H - PAD_T - PAD_B + 12}
            />
            <line className="nchart-now" x1={x(nowT)} x2={x(nowT)} y1={PAD_T - 6} y2={H - PAD_B + 6} />
            <text className="mchart-xlabel" x={x(nowT)} y={H - 8}>
              now
            </text>
          </>
        )}
        {d && <path className="nchart-line" d={d} />}
        {last && (
          <circle
            className="nchart-dot"
            cx={Math.min(x(Math.max(new Date(last.at).getTime(), Math.min(nowT, x1))), W - PAD_R)}
            cy={y(last.value)}
            r={3.5}
          />
        )}
        {inWindow.map(m => {
          const mx = x(new Date(m.resolvesOn).getTime());
          const my = m.consensus === null ? null : y(m.consensus);
          return (
            <g key={m.marketId} className={m.selected ? 'nchart-marker is-selected' : 'nchart-marker'}>
              <line x1={mx} x2={mx} y1={PAD_T - 6} y2={H - PAD_B + 6} />
              {my !== null && <circle cx={mx} cy={my} r={m.selected ? 4.5 : 3.5} />}
              {m.selected && my !== null && m.consensus !== null && (
                <text x={mx - 8} y={my + 4} textAnchor="end">
                  {fmt(m.consensus, unit)}
                </text>
              )}
            </g>
          );
        })}
        {beyondLeft && (
          <text className="nchart-beyond" x={PAD_L + 2} y={(PAD_T + H - PAD_B) / 2}>
            ‹
          </text>
        )}
        {beyondRight && (
          <text className="nchart-beyond" x={W - PAD_R + 6} y={(PAD_T + H - PAD_B) / 2}>
            ›
          </text>
        )}
        <text className="mchart-xlabel" x={PAD_L + 20} y={H - 8}>
          {dayLabel(x0)}
        </text>
        <foreignObject x={W - 200} y={H - 18} width={200 - PAD_R + 18} height={18}>
          <div className="mchart-corner mchart-corner--bottom" role="group" aria-label="Time range">
            {words.map((w, i) => {
              const active = rangeKey ? rangeKey === w.key : i === 0;
              return (
                <button
                  key={w.key}
                  className={`mchart-word${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setRangeKey(w.key)}
                >
                  {w.key}
                </button>
              );
            })}
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}
