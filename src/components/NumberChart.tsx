import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { forecastDayOf } from '../lib/floor-horizons';
import { formatImpact, formatPairValue, pairNeedsDecimals } from '../lib/formatImpact';
import { GEOM } from './MarketChart';

/**
 * ONE chart, the number's own, with the market's call drawn on it
 * (docs/ui-conventions.md, "The chart"): the metric's readings as an ink
 * line up to a "now" rule, the selected market's call since it opened as a
 * thin amber step, a dotted connector from that line's end at now to the
 * settle marker, and, with a proposal open, the pair's two branch calls as
 * green and red steps with connectors of their own.
 *
 * There is no second chart. "How the call moved" was a half-height strip
 * under this one, and two charts stacked with a stat each read to a trader
 * as two different numbers (removed 2026-09-08).
 */

export interface NumberPoint {
  at: string;
  value: number;
}

/** One point of a market's own call over time, as the history endpoint sends it. */
export interface CallPoint {
  at: string;
  consensus: number | null;
}

export interface NumberMarker {
  marketId: string;
  /** Settle instant, ISO. */
  resolvesOn: string;
  consensus: number | null;
  selected: boolean;
  /** The open proposal's conditional pair on this market, when one is open:
   *  what the metric reads if the proposal is approved and if it is declined. */
  pair?: { approved: number | null; declined: number | null } | null;
}

interface Props {
  points: NumberPoint[];
  /** The selected market's call since it opened. The series STARTS at the
   *  price the market opened at, stamped with its creation time (the server
   *  anchors it), so a pair traded once draws as a move and not a cliff. */
  call?: CallPoint[];
  /** With a proposal open, the pair's own two histories. Their presence is
   *  what makes this the proposal's chart: the legend gains its toggles. */
  branches?: { approved: CallPoint[]; declined: CallPoint[] } | null;
  markers: NumberMarker[];
  /** The settlement range, for the two rails and the axis label. */
  rangeMin?: number | null;
  rangeMax?: number | null;
  /** Settle instant of the market on screen, ISO; the window ends here. */
  selectedResolvesOn: string;
  /** 'day' | 'week' | 'month' | 'other', from the selected market's target date. */
  granularity: Granularity;
  unit?: string;
  /** The left of the control row: the metric's own name. */
  center?: ReactNode;
  now?: Date;
  height?: number;
  /** The composed bet's ghost (owner ask 2026-08-28): where the SELECTED
   *  market's call would move, drawn on its marker. */
  preview?: { value: number; direction: 'higher' | 'lower' } | null;
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

/**
 * How wide a settle label draws, in the svg's own units.
 *
 * The labels sit INSIDE the plot to the left of their marker, so the plot
 * has to keep a right margin at least this wide or "19.8 · settles" is
 * clipped by the column edge (docs/ui-conventions.md, "The chart"). Mono at
 * 10px advances about 6 units a character; the tail is the gap to the dot.
 */
export function labelWidth(text: string): number {
  return text.length * 6 + 10;
}

/**
 * Label dodging: the dots stay where the values are, the labels keep a
 * minimum gap. Labels are sorted by their anchor, pushed apart to `gap`,
 * then pulled back inside [top, bottom]. A label that moved gets a leader
 * line to its dot (owner report 2026-08-27: "avoid text colliding").
 */
export function dodge<T extends { at: number }>(
  labels: T[],
  top: number,
  bottom: number,
  gap = 13,
): Array<T & { y: number }> {
  const sorted = [...labels].sort((a, b) => a.at - b.at).map(l => ({ ...l, y: l.at }));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) for (const l of sorted) l.y -= overflow;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].y < top) sorted[i].y = top;
    if (i > 0 && sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  return sorted;
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

const PAD_T = 24;
const PAD_B = 34;

export function fmt(v: number, unit: string): string {
  const abs = Math.abs(v);
  // Millions and billions compact (a $10,000,000 marker label ran off the
  // plot, owner report 2026-08-28); thousands stay exact, they are quotes.
  const s =
    abs >= 1e9
      ? `${(v / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
      : abs >= 1e6
        ? `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
        : abs >= 1000
          ? Math.round(v).toLocaleString('en-US')
          : abs >= 100 || Number.isInteger(Number(v.toFixed(6)))
            ? Number(v.toFixed(6)).toFixed(0)
            : v.toFixed(1);
  return unit + s;
}

/** A branch label's value: the usual label precision, unless the pair needs
 *  reconciling decimals (docs/ui-conventions.md, "The pair band": the
 *  chart's branch labels use the band's rule). */
function fmtBranch(v: number, other: number | null, unit: string): string {
  if (other !== null && Math.abs(v) < 1000 && pairNeedsDecimals(v, other, x => fmt(x, unit))) {
    return formatPairValue(v, unit);
  }
  return fmt(v, unit);
}

function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const round = (v: number) => Number(v.toFixed(3));

/** A call series as a staircase: hold the level, then step to the next one,
 *  then hold to `endX`. A market nobody has traded is one point, and draws
 *  flat at the price it opened at. */
function stepPath(
  series: Array<{ t: number; v: number }>,
  x: (t: number) => number,
  y: (v: number) => number,
  endX: number,
): string {
  if (series.length === 0) return '';
  const parts = [`M${round(x(series[0].t))} ${round(y(series[0].v))}`];
  for (let i = 1; i < series.length; i++) {
    parts.push(`L${round(x(series[i].t))} ${round(y(series[i - 1].v))}`);
    parts.push(`L${round(x(series[i].t))} ${round(y(series[i].v))}`);
  }
  parts.push(`L${round(endX)} ${round(y(series[series.length - 1].v))}`);
  return parts.join(' ');
}

/** A call series clipped to the window, with the level in force at the
 *  window's start kept as its first point so the line never starts mid-air. */
function clipCall(series: CallPoint[] | undefined, x0: number, x1: number): Array<{ t: number; v: number }> {
  const all = (series ?? [])
    .filter((p): p is { at: string; consensus: number } => typeof p.consensus === 'number')
    .map(p => ({ t: new Date(p.at).getTime(), v: p.consensus }))
    .sort((a, b) => a.t - b.t);
  const inside = all.filter(p => p.t >= x0 && p.t <= x1);
  const before = all.filter(p => p.t < x0).pop();
  return before ? [{ t: x0, v: before.v }, ...inside] : inside;
}

export function NumberChart({
  points,
  call,
  branches = null,
  markers,
  rangeMin = null,
  rangeMax = null,
  selectedResolvesOn,
  granularity,
  unit = '',
  center,
  now: nowProp,
  height,
  preview = null,
}: Props) {
  // Anchored once per mount, never per render: a per-render default was a
  // fresh advancing timestamp that moved the tween target every render,
  // restarting the domain rAF loop forever (60fps setState, allocating a
  // fresh array per frame). Callers that pass `now` are unaffected.
  const [mountNow] = useState(() => new Date());
  const now = nowProp ?? mountNow;
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 520);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 519px)');
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const { W, PAD_L, PAD_R: basePadR, H: geomH } = GEOM[compact ? 'compact' : 'wide'];
  const H = height ?? geomH;
  const words = RANGE_WORDS[granularity];
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  // Which lines the legend has switched off, so four lines on a phone can be
  // read one at a time.
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => setRangeKey(null), [selectedResolvesOn]);
  const span = (rangeKey ? words.find(w => w.key === rangeKey) : words[0])?.ms ?? null;
  const target = windowFor(selectedResolvesOn, span, points, now);
  const [x0, x1] = useTweenedDomain(target);

  const selected = markers.find(m => m.selected) ?? null;
  const pair = selected?.pair ?? null;
  const hasPair = !!branches && pair !== null && pair.approved !== null && pair.declined !== null;
  const ap = hasPair ? (pair?.approved as number) : null;
  const dc = hasPair ? (pair?.declined as number) : null;

  // The labels the plot has to leave room for, computed before the geometry:
  // the right margin is the width of the widest of them.
  const settleText = selected?.consensus !== null && selected ? `${fmt(selected.consensus, unit)} · settles` : null;
  const branchTexts =
    hasPair && ap !== null && dc !== null
      ? [
          `if approved ${fmtBranch(ap, dc, unit)}`,
          `if declined ${fmtBranch(dc, ap, unit)}`,
          formatImpact(ap - dc, unit),
        ]
      : [];
  const labelTexts = [...(settleText ? [settleText] : []), ...branchTexts];
  const PAD_R = Math.max(basePadR, ...labelTexts.map(labelWidth));
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
  const callLine = clipCall(call, x0, x1);
  const approvedLine = clipCall(branches?.approved, x0, x1);
  const declinedLine = clipCall(branches?.declined, x0, x1);
  const ys = [
    ...drawn.map(p => p.value),
    ...callLine.map(p => p.v),
    ...approvedLine.map(p => p.v),
    ...declinedLine.map(p => p.v),
    ...inWindow.flatMap(m => (m.consensus === null ? [] : [m.consensus])),
    ...inWindow.flatMap(m => [m.pair?.approved, m.pair?.declined].filter((v): v is number => typeof v === 'number')),
    ...(preview ? [preview.value] : []),
  ];
  const rawLo = ys.length ? Math.min(...ys) : 0;
  const rawHi = ys.length ? Math.max(...ys) : 1;
  // The axis never magnifies a wobble into a cliff (docs/ui-conventions.md):
  // it spans at least a tenth of the largest value drawn, widened around the
  // middle of what is there. Three readings within an hour, 6,107 to 6,126,
  // used to fill the plot from floor to ceiling (owner report 2026-09-02).
  const scale = Math.max(Math.abs(rawLo), Math.abs(rawHi));
  const minSpan = scale > 0 ? scale * 0.1 : 1;
  const widen = Math.max(0, minSpan - (rawHi - rawLo)) / 2;
  const lo = rawLo - widen;
  const hi = rawHi + widen;
  const dataSpan = hi - lo;
  // The axis is the data with a tenth of padding, never the whole settlement
  // range: a 0-to-50 axis under a number that moves between 9 and 20 is a
  // flat line. A range rail joins it only when it falls inside twice the data
  // span, so the payout words have a picture whenever the picture is legible.
  const railTop = rangeMax !== null && rangeMax <= hi + dataSpan;
  const railBottom = rangeMin !== null && rangeMin >= lo - dataSpan;
  const y0 = Math.min(lo - dataSpan * 0.1, railBottom ? (rangeMin as number) : Number.POSITIVE_INFINITY);
  const y1 = Math.max(hi + dataSpan * 0.1, railTop ? (rangeMax as number) : Number.NEGATIVE_INFINITY);
  const y = (v: number) => PAD_T + (1 - (v - y0) / (y1 - y0)) * (H - PAD_T - PAD_B);
  const railsShown = railTop && railBottom;
  const rangeLabel =
    !railsShown && rangeMin !== null && rangeMax !== null
      ? `range ${fmt(rangeMin, unit)} to ${fmt(rangeMax, unit)}`
      : null;
  // Three-ish ticks on round numbers, so the axis reads 5 / 10 / 15 and
  // never 2.5 / 7.5 / 12.4.
  const rawStep = (y1 - y0) / 3;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map(k => k * mag).find(k => k >= rawStep) ?? rawStep;
  const ticks: number[] = [];
  for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) ticks.push(Number(t.toFixed(6)));

  const nowT = now.getTime();
  // Readings joined by straight segments with a dot at each reading, then a
  // dashed hold from the last reading to now: the value in force. A step
  // line read as a staircase of a daily-synced level, which nobody meant.
  const pts = drawn.map(p => [x(new Date(p.at).getTime()), y(p.value)] as const);
  const d = pts.map(([px, py], i) => (i === 0 ? `M${round(px)} ${round(py)}` : `L${round(px)} ${round(py)}`)).join(' ');
  const last = drawn[drawn.length - 1];
  const lastX = last ? x(new Date(last.at).getTime()) : 0;
  const holdX = Math.min(x(nowT), W - PAD_R);
  const selectedX = selected ? x(new Date(selected.resolvesOn).getTime()) : null;
  /** One branch's step line, its connector and the marker value it lands on. */
  const branchDraw = (which: 'approved' | 'declined') => {
    const series = which === 'approved' ? approvedLine : declinedLine;
    const at = which === 'approved' ? ap : dc;
    if (hidden[which] || series.length === 0) return null;
    return {
      which,
      d: stepPath(series, x, y, holdX),
      endY: y(series[series.length - 1].v),
      to: at === null ? null : y(at),
      level: series[series.length - 1].v,
    };
  };
  // Whichever branch the markets price higher sits on top.
  const branchDraws = [branchDraw('approved'), branchDraw('declined')]
    .filter((b): b is NonNullable<ReturnType<typeof branchDraw>> => b !== null)
    .sort((a, b) => a.level - b.level);

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    // The svg scales uniformly with its width (height auto), so the
    // viewBox-to-pixel ratio is rect.width / W; then map through the plot
    // area, not the whole svg.
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (mouseX - PAD_L) / (W - PAD_L - PAD_R);
    setCursor(x0 + Math.max(0, Math.min(1, frac)) * (x1 - x0));
  };
  const onLeave = () => setCursor(null);
  // What the cursor is over: a reading in force, or a market's call.
  let tip: {
    x: number;
    y: number;
    date: string;
    label: string;
    value: string;
    extra?: Array<{ label: string; value: string; tone: 'approved' | 'declined' }>;
  } | null = null;
  if (cursor !== null) {
    if (cursor <= nowT) {
      // Snap to the nearest reading: the line is drawn through the readings,
      // so the only honest places for the dot are the readings themselves.
      const nearest = visible
        .map(p => ({ p, dt: Math.abs(new Date(p.at).getTime() - cursor) }))
        .sort((a, b) => a.dt - b.dt)[0]?.p;
      if (!nearest) {
        tip = {
          x: x(cursor),
          y: (PAD_T + H - PAD_B) / 2,
          date: new Date(cursor).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          }),
          label: 'no reading yet',
          value: '',
        };
      } else {
        tip = {
          x: x(new Date(nearest.at).getTime()),
          y: y(nearest.value),
          date: new Date(nearest.at).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          }),
          label: 'reading',
          value: fmt(nearest.value, unit),
        };
      }
    } else {
      const near = inWindow
        .filter(m => m.consensus !== null)
        .sort(
          (a, b) =>
            Math.abs(new Date(a.resolvesOn).getTime() - cursor) - Math.abs(new Date(b.resolvesOn).getTime() - cursor),
        )[0];
      if (near && near.consensus !== null) {
        tip = {
          x: x(new Date(near.resolvesOn).getTime()),
          y: y(near.consensus),
          // The settle instant is the first moment after the period; the day a
          // reader is forecasting is the one before it, as the picker says.
          date: dayLabel(new Date(near.resolvesOn).getTime() - 1),
          label: near.selected ? 'the market says' : 'another market says',
          value: fmt(near.consensus, unit),
          extra:
            near.pair && near.pair.approved !== null && near.pair.declined !== null
              ? [
                  { label: 'if approved', value: fmt(near.pair.approved, unit), tone: 'approved' },
                  { label: 'if declined', value: fmt(near.pair.declined, unit), tone: 'declined' },
                ]
              : undefined,
        };
      }
    }
  }

  const toggle = (key: string) => setHidden(h => ({ ...h, [key]: !h[key] }));
  const legendToggle = (key: string, label: string, mark: string) => (
    <button
      key={key}
      type="button"
      className={`nchart-legend-go${hidden[key] ? ' is-off' : ''}`}
      aria-pressed={!hidden[key]}
      onClick={() => toggle(key)}
    >
      <i className={mark} />
      {label}
    </button>
  );

  return (
    <div className="mchart nchart">
      <div className="mchart-ranges" role="group" aria-label="Time range">
        <span className="mchart-left">{center}</span>
        <span className="mchart-center" />
        <span className="mchart-right">
          {words.map((w, i) => {
            const active = rangeKey ? rangeKey === w.key : i === 0;
            return (
              <button
                key={w.key}
                className={`mchart-range${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => setRangeKey(w.key)}
              >
                {w.key}
              </button>
            );
          })}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mchart-svg"
        role="img"
        aria-label="The number and the market's calls"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        {ticks.map(t => (
          <g key={t}>
            <line className="mchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} />
            <text className="mchart-ylabel" x={PAD_L - 6} y={y(t) + 3}>
              {fmt(t, unit)}
            </text>
          </g>
        ))}
        {/* The range rails: the payout words on the verbs have a picture
            whenever the picture is legible. */}
        {([railTop ? (rangeMax as number) : null, railBottom ? (rangeMin as number) : null] as const)
          .filter((v): v is number => v !== null)
          .map(v => (
            <g key={`rail-${v}`}>
              <line className="nchart-rail" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
              <text className="nchart-rail-label" x={PAD_L - 6} y={y(v) + 3}>
                {fmt(v, unit)}
              </text>
            </g>
          ))}
        {rangeLabel && (
          <text className="nchart-range-label" x={PAD_L + 6} y={PAD_T + 4}>
            {rangeLabel}
          </text>
        )}
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
        {d && !hidden.reading && (
          <path key={`line-${selectedResolvesOn}`} className="nchart-line" d={d} pathLength={1} />
        )}
        {!hidden.reading && last && nowT > new Date(last.at).getTime() && holdX > lastX && (
          <line className="nchart-hold" x1={lastX} x2={holdX} y1={y(last.value)} y2={y(last.value)} />
        )}
        {!hidden.reading &&
          visible.map(p => (
            <circle key={p.at} className="nchart-dot" cx={x(new Date(p.at).getTime())} cy={y(p.value)} r={3} />
          ))}
        {/* The market's call over time, and the dotted connector from its end
            at now to the settle marker. Dotted so it never reads as a
            forecast path. */}
        {!hidden.call && callLine.length > 0 && (
          <path className="nchart-call" d={stepPath(callLine, x, y, holdX)} pathLength={1} />
        )}
        {!hidden.call && callLine.length > 0 && selectedX !== null && selected?.consensus !== null && selected && (
          <line
            className="nchart-connector"
            x1={holdX}
            x2={selectedX}
            y1={y(callLine[callLine.length - 1].v)}
            y2={y(selected.consensus)}
          />
        )}
        {branchDraws.map(b => (
          <path key={b.which} className={`nchart-branch nchart-branch--${b.which}`} d={b.d} pathLength={1} />
        ))}
        {branchDraws.map(b =>
          b.to === null || selectedX === null ? null : (
            <line
              key={b.which}
              className={`nchart-connector--${b.which}`}
              x1={holdX}
              x2={selectedX}
              y1={b.endY}
              y2={b.to}
            />
          ),
        )}
        {inWindow.map(m => {
          const mx = x(new Date(m.resolvesOn).getTime());
          const my = m.consensus === null ? null : y(m.consensus);
          const mAp = m.selected && hasPair ? ap : null;
          const mDc = m.selected && hasPair ? dc : null;
          const ay = mAp === null ? null : y(mAp);
          const dy = mDc === null ? null : y(mDc);
          return (
            <g key={m.marketId} className={m.selected ? 'nchart-marker is-selected' : 'nchart-marker'}>
              {ay !== null && !hidden.approved && <circle className="nchart-pair-approved" cx={mx} cy={ay} r={4.5} />}
              {dy !== null && !hidden.declined && <circle className="nchart-pair-declined" cx={mx} cy={dy} r={4.5} />}
              {my !== null && !hidden.call && <circle cx={mx} cy={my} r={m.selected ? 4.5 : 3.5} />}
              {m.selected && preview && (
                <g className={`mchart-ghost mchart-ghost--${preview.direction}`}>
                  {my !== null && <line className="mchart-ghost-line" x1={mx} x2={mx} y1={my} y2={y(preview.value)} />}
                  <circle className="mchart-ghost-dot" cx={mx} cy={y(preview.value)} r="4.5" />
                </g>
              )}
              {m.selected &&
                dodge(
                  [
                    ...(preview
                      ? [
                          {
                            key: 'preview',
                            at: y(preview.value),
                            text: `${preview.direction === 'higher' ? '▲' : '▼'} ${fmt(preview.value, unit)}`,
                            cls: `mchart-ghost-label mchart-ghost--${preview.direction}`,
                          },
                        ]
                      : []),
                    ...(ay !== null && mAp !== null && mDc !== null && !hidden.approved
                      ? [
                          {
                            key: 'approved',
                            at: ay,
                            text: `if approved ${fmtBranch(mAp, mDc, unit)}`,
                            cls: 'nchart-pair-label nchart-pair-label--approved',
                          },
                        ]
                      : []),
                    ...(my !== null && m.consensus !== null && settleText && !hidden.call
                      ? [{ key: 'now', at: my, text: settleText, cls: 'nchart-now-label' }]
                      : []),
                    ...(dy !== null && mDc !== null && mAp !== null && !hidden.declined
                      ? [
                          {
                            key: 'declined',
                            at: dy,
                            text: `if declined ${fmtBranch(mDc, mAp, unit)}`,
                            cls: 'nchart-pair-label nchart-pair-label--declined',
                          },
                        ]
                      : []),
                    ...(mAp !== null && mDc !== null && ay !== null && dy !== null
                      ? [
                          {
                            key: 'delta',
                            at: (ay + dy) / 2,
                            text: formatImpact(mAp - mDc, unit),
                            cls: 'nchart-pair-delta',
                          },
                        ]
                      : []),
                  ],
                  PAD_T + 4,
                  H - PAD_B - 4,
                ).map(l => (
                  <g key={l.key}>
                    {Math.abs(l.y - l.at) > 4 && (
                      <line className="nchart-leader" x1={mx - 6} x2={mx - 34} y1={l.at} y2={l.y} />
                    )}
                    <text className={l.cls} x={mx - (Math.abs(l.y - l.at) > 4 ? 38 : 9)} y={l.y + 4} textAnchor="end">
                      {l.text}
                    </text>
                  </g>
                ))}
            </g>
          );
        })}
        {points.length === 0 && (
          <text
            className="nchart-empty"
            x={(PAD_L + Math.min(x(nowT), W - PAD_R)) / 2}
            y={(PAD_T + H - PAD_B) / 2}
            textAnchor="middle"
          >
            no reading yet
          </text>
        )}
        {tip && (
          <g className="mchart-cross">
            <line x1={tip.x} x2={tip.x} y1={PAD_T - 6} y2={H - PAD_B + 6} />
            <circle className="mchart-cross-mkt" cx={tip.x} cy={tip.y} r={4} />
          </g>
        )}
        <text className="mchart-xlabel" x={PAD_L + 20} y={H - 8}>
          {dayLabel(x0)}
        </text>
      </svg>
      {/* The legend names the marks in a few words each. With a proposal open
          it is four toggles, so four lines on a phone can be read one at a
          time. */}
      <div className="nchart-legend" aria-label="Legend">
        {branches ? (
          <>
            {legendToggle('reading', 'reading', 'nchart-legend-line')}
            {legendToggle('call', 'market now', 'nchart-legend-rule nchart-legend-rule--now')}
            {legendToggle('approved', 'if approved', 'nchart-legend-rule nchart-legend-rule--approved')}
            {legendToggle('declined', 'if declined', 'nchart-legend-rule nchart-legend-rule--declined')}
          </>
        ) : (
          <>
            <span>
              <i className="nchart-legend-line" />
              reading
            </span>
            <span>
              <i className="nchart-legend-rule nchart-legend-rule--now" />
              market's call
            </span>
            {selected && (
              <span>
                <i className="nchart-legend-dot nchart-legend-dot--now" />
                settles {forecastDayOf(selectedResolvesOn)}
              </span>
            )}
            {markers.some(m => !m.selected) && (
              <span>
                <i className="nchart-legend-dot nchart-legend-dot--other" />
                other open dates
              </span>
            )}
          </>
        )}
      </div>
      {tip && (
        <div className={`mchart-tip${tip.x > W * 0.6 ? ' is-right' : ''}`} style={{ left: `${(tip.x / W) * 100}%` }}>
          <div className="mchart-tip-date">{tip.date}</div>
          <div>
            {tip.label} <span className="mchart-tip-v">{tip.value}</span>
          </div>
          {tip.extra?.map(e => (
            <div key={e.tone} className={`nchart-tip-${e.tone}`}>
              {e.label} <span className="mchart-tip-v">{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
