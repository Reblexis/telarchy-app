import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { forecastDayOf } from '../lib/floor-horizons';
import { clockOf, dayOf } from '../lib/viewer-time';
import { GEOM } from './MarketChart';

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
  /** The open proposal's conditional pair on this market, when one is open:
   *  what the metric reads if the proposal is approved and if it is declined. */
  pair?: { approved: number | null; declined: number | null } | null;
}

/**
 * One option of a proposal with options, drawn as its own line
 * (docs/ui-conventions.md, "A proposal with options shows one world per
 * option", "The chart draws every option"): its market's call over time,
 * held to the settle instant at its call now, and labelled there with its
 * price and its name. The selected option (`emphasis`) is the green at full
 * weight, the others thinner in the muted ink. An option with no price
 * (`consensus` null) is not drawn.
 */
export interface NumberSeries {
  id: string;
  label: string;
  /** The option market's call over time, oldest first. */
  points: NumberPoint[];
  consensus: number | null;
  emphasis: boolean;
}

interface Props {
  points: NumberPoint[];
  markers: NumberMarker[];
  /** Settle instant of the market on screen, ISO; the window ends here. */
  selectedResolvesOn: string;
  /** 'day' | 'week' | 'month' | 'other', from the selected market's target date. */
  granularity: Granularity;
  unit?: string;
  /** The view toggle words, at the left of the control row. */
  corner?: ReactNode;
  /** The centre of the control row: the time left until the market settles. */
  center?: ReactNode;
  /** Which world the impact label is stated from: '+7.8' on the approved
   *  branch becomes '-7.8' on the declined one (owner ask 2026-08-26). */
  impactFrom?: 'approved' | 'declined';
  /** The legend under the chart when a proposal is open, in its own words:
   *  "if Jason is paid $80" / "if not" / "the market now". */
  legend?: { approved: string; declined: string } | null;
  /** The legend that names the marks when no proposal is open (docs/
   *  ui-conventions.md, "The price and the chart"): the ink line "actual",
   *  the amber dot "market's call for <day>", the grey dots "other open
   *  dates" only when there are any. A proposal's legend replaces it. */
  marksLegend?: boolean;
  /** Press a marker to select that date's market. The selected one is not
   *  pressable, because it is where the reader already is; with no handler
   *  the chart stays a picture (docs/ui-conventions.md, "The price and the
   *  chart", 2026-09-09). */
  onPickDate?: (marketId: string) => void;
  now?: Date;
  height?: number;
  /** The composed bet's ghost (owner ask 2026-08-28): where the SELECTED
   *  market's call would move, drawn on its marker in the market chart's
   *  own ghost vocabulary. */
  preview?: { value: number; direction: 'higher' | 'lower' } | null;
  /** A proposal with options on screen: every option as a line. With any
   *  priced, the selected date's marker draws no unconditional call and no
   *  pair, and the legend names the options. */
  series?: NumberSeries[] | null;
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
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}(:\d{2})?)?$/.test(targetDate)) return 'day';
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

/** The axis day, in the viewer's zone (docs/ui-conventions.md, "Every clock on the floor reads in the viewer's zone"). */
function nowTOf(d: Date): number {
  return d.getTime();
}

function dayLabel(t: number): string {
  return dayOf(new Date(t));
}

export function NumberChart({
  points,
  markers,
  selectedResolvesOn,
  granularity,
  unit = '',
  corner,
  center,
  legend = null,
  marksLegend = false,
  impactFrom = 'approved',
  onPickDate,
  now: nowProp,
  height,
  preview = null,
  series = null,
}: Props) {
  // Anchored once per mount, never per render: a per-render default was a
  // fresh advancing timestamp that moved the tween target every render,
  // restarting the domain rAF loop forever (60fps setState, allocating a
  // fresh array per frame). Callers that pass `now` are unaffected.
  const [mountNow] = useState(() => new Date());
  const now = nowProp ?? mountNow;
  // Same geometry and breakpoint as the market view (GEOM is theirs), so the
  // two views of the chart slot have one width, one plot area and one
  // pointer mapping.
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 520);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 519px)');
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const { W, PAD_L, PAD_R, H: geomH } = GEOM[compact ? 'compact' : 'wide'];
  const H = height ?? geomH;
  const words = RANGE_WORDS[granularity];
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  // Hover: the reading in force at the cursor on the past side, the nearest
  // market's call on the future side (owner ask: "when i hover over it i
  // should see the value").
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // The automatic window is the first range word of the granularity; the
  // key resets when the selected market changes so a new date opens on its
  // own default window.
  useEffect(() => setRangeKey(null), [selectedResolvesOn]);
  const span = (rangeKey ? words.find(w => w.key === rangeKey) : words[0])?.ms ?? null;
  const target = windowFor(selectedResolvesOn, span, points, now);
  const [x0, x1] = useTweenedDomain(target);
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
  /* The options, each a line through its market's call history (inside the
     window, carried in at the window's start) held to the settle instant.
     No baseline: with options there is no world without the proposal. */
  const settleT = new Date(selectedResolvesOn).getTime();
  const drawnSeries = (series ?? [])
    .filter((s): s is NumberSeries & { consensus: number } => typeof s.consensus === 'number')
    .map(s => {
      const pts = s.points
        .map(p => ({ t: new Date(p.at).getTime(), v: p.value }))
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t < settleT)
        .sort((a, b) => a.t - b.t);
      const carried = pts.filter(p => p.t < x0).pop();
      const inside = pts.filter(p => p.t >= x0);
      const traced = carried ? [{ t: x0, v: carried.v }, ...inside] : inside;
      // Untraded: a held line from now, never a lone dot at the settle instant.
      const start = traced.length > 0 ? traced : [{ t: Math.max(x0, Math.min(nowTOf(now), settleT)), v: s.consensus }];
      return { ...s, line: [...start, { t: settleT, v: s.consensus }] };
    });
  const optionMode = drawnSeries.length > 0;
  const ys = [
    ...drawnSeries.flatMap(s => s.line.map(p => p.v)),
    ...drawn.map(p => p.value),
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
  const span_y = hi - lo;
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
  // Readings joined by straight segments with a dot at each reading, then a
  // dashed hold from the last reading to now: the value in force. A step
  // line read as a staircase of a daily-synced level, which nobody meant.
  const pts = drawn.map(p => [x(new Date(p.at).getTime()), y(p.value)] as const);
  const d = pts.map(([px, py], i) => (i === 0 ? `M${px} ${py}` : `L${px} ${py}`)).join(' ');
  const last = drawn[drawn.length - 1];
  const lastX = last ? x(new Date(last.at).getTime()) : 0;
  const holdX = Math.min(x(nowT), W - PAD_R);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    // The svg scales uniformly with its width (height auto), so the
    // viewBox-to-pixel ratio is rect.width / W; then map through the plot
    // area, not the whole svg, exactly as the market view does.
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
    extra?: Array<{ label: string; value: string; tone: 'approved' | 'declined' | 'option' }>;
  } | null = null;
  if (cursor !== null) {
    if (cursor <= nowT) {
      // Snap to the nearest reading: the line is drawn through the readings,
      // so the only honest places for the dot are the readings themselves.
      // A "value in force" dot between two readings floated off the line
      // (owner report: "why is the dot not on the actual graph line").
      const nearest = visible
        .map(p => ({ p, dt: Math.abs(new Date(p.at).getTime() - cursor) }))
        .sort((a, b) => a.dt - b.dt)[0]?.p;
      if (!nearest) {
        tip = {
          x: x(cursor),
          y: (PAD_T + H - PAD_B) / 2,
          date: `${dayOf(new Date(cursor))}, ${clockOf(new Date(cursor))}`,
          label: 'no reading yet',
          value: '',
        };
      } else {
        tip = {
          x: x(new Date(nearest.at).getTime()),
          y: y(nearest.value),
          date: `${dayOf(nearest.at)}, ${clockOf(nearest.at)}`,
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
          label:
            optionMode && near.selected ? 'the options say' : near.selected ? 'the market says' : 'another market says',
          value: optionMode && near.selected ? '' : fmt(near.consensus, unit),
          extra:
            optionMode && near.selected
              ? drawnSeries.map(s => ({ label: s.label, value: fmt(s.consensus, unit), tone: 'option' }))
              : near.pair && near.pair.approved !== null && near.pair.declined !== null
                ? [
                    { label: 'if approved', value: fmt(near.pair.approved, unit), tone: 'approved' },
                    { label: 'if declined', value: fmt(near.pair.declined, unit), tone: 'declined' },
                  ]
                : undefined,
        };
      }
    }
  }

  return (
    <div className="mchart nchart">
      <div className="mchart-ranges" role="group" aria-label="Time range">
        <span className="mchart-left">{corner && <span className="mchart-corner">{corner}</span>}</span>
        <span className="mchart-center">{center}</span>
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
        {d && <path key={`line-${selectedResolvesOn}`} className="nchart-line" d={d} pathLength={1} />}
        {last && nowT > new Date(last.at).getTime() && holdX > lastX && (
          <line className="nchart-hold" x1={lastX} x2={holdX} y1={y(last.value)} y2={y(last.value)} />
        )}
        {visible.map(p => (
          <circle key={p.at} className="nchart-dot" cx={x(new Date(p.at).getTime())} cy={y(p.value)} r={3} />
        ))}
        {inWindow.map(m => {
          const mx = x(new Date(m.resolvesOn).getTime());
          const my = m.consensus === null || (optionMode && m.selected) ? null : y(m.consensus);
          // With options on screen, the selected date's marker is the settle
          // instant only: no unconditional call, no pair (the lines carry it).
          const bare = optionMode && m.selected;
          const ap = bare ? null : (m.pair?.approved ?? null);
          const dc = bare ? null : (m.pair?.declined ?? null);
          const hasPair = ap !== null && dc !== null;
          const ay = ap === null ? null : y(ap);
          const dy = dc === null ? null : y(dc);
          /* Every open date in the settlement band is the date control: the
             same act as pressing its tab in the date strip. */
          const pickable = !!onPickDate && !m.selected;
          const pick = pickable
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': `${dayLabel(new Date(m.resolvesOn).getTime())}${
                  m.consensus === null ? '' : `, ${fmt(m.consensus, unit)}`
                }`,
                onClick: () => onPickDate?.(m.marketId),
                onKeyDown: (e: ReactKeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPickDate?.(m.marketId);
                  }
                },
              }
            : {};
          return (
            <g
              key={m.marketId}
              data-market={m.marketId}
              className={`nchart-marker${m.selected ? ' is-selected' : ''}${pickable ? ' is-pickable' : ''}`}
              {...pick}
            >
              <line x1={mx} x2={mx} y1={PAD_T - 6} y2={H - PAD_B + 6} />
              {/* The proposal's pair: green if approved, red if declined, a
                bar between them whose length is the priced impact. */}
              {hasPair && ay !== null && dy !== null && (
                <g className="nchart-pair">
                  <line className="nchart-pair-bar" x1={mx} x2={mx} y1={Math.min(ay, dy)} y2={Math.max(ay, dy)} />
                  <circle className="nchart-pair-approved" cx={mx} cy={ay} r={m.selected ? 4.5 : 3} />
                  <circle className="nchart-pair-declined" cx={mx} cy={dy} r={m.selected ? 4.5 : 3} />
                  {m.selected && (
                    <text
                      className="nchart-pair-delta"
                      x={mx + 40 <= W ? mx + 8 : mx - 8}
                      y={(ay + dy) / 2 + 4}
                      textAnchor={mx + 40 <= W ? 'start' : 'end'}
                    >
                      {(impactFrom === 'declined' ? dc - ap : ap - dc) >= 0 ? '+' : '-'}
                      {fmt(Math.abs(ap - dc), unit)}
                    </text>
                  )}
                </g>
              )}
              {my !== null && <circle cx={mx} cy={my} r={m.selected ? 4.5 : 3.5} />}
              {/* The other open dates carry their call, so the date strip and
                the settlement band say the same thing (2026-09-09). */}
              {my !== null && !m.selected && !hasPair && mx >= x(nowT) && (
                <text className="nchart-marker-val" x={mx} y={my - 9} textAnchor="middle">
                  {fmt(m.consensus as number, unit)}
                </text>
              )}
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
                    ...(hasPair && ay !== null && ap !== null
                      ? [
                          {
                            key: 'approved',
                            at: ay,
                            text: `if approved ${fmt(ap, unit)}`,
                            cls: 'nchart-pair-label nchart-pair-label--approved',
                          },
                        ]
                      : []),
                    ...(my !== null && m.consensus !== null
                      ? [
                          {
                            key: 'now',
                            at: my,
                            /* With a pair on screen this line is the market
                             WITHOUT the proposal, and "now" was already the
                             last logged reading in the cell beside it, 8%
                             away (review 2026-09-10). */
                            text: hasPair ? `${fmt(m.consensus, unit)} without it` : fmt(m.consensus, unit),
                            cls: 'nchart-now-label',
                          },
                        ]
                      : []),
                    ...(hasPair && dy !== null && dc !== null
                      ? [
                          {
                            key: 'declined',
                            at: dy,
                            text: `if declined ${fmt(dc, unit)}`,
                            cls: 'nchart-pair-label nchart-pair-label--declined',
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
        {optionMode && (
          <g className="nchart-options">
            {[...drawnSeries.filter(s => !s.emphasis), ...drawnSeries.filter(s => s.emphasis)].map(s => {
              const d = s.line.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)} ${y(p.v)}`).join(' ');
              return (
                <g key={s.id} className={`nchart-series${s.emphasis ? ' is-selected' : ''}`} data-option={s.id}>
                  <path className="nchart-series-line" d={d} />
                  <circle className="nchart-series-dot" cx={x(settleT)} cy={y(s.consensus)} r={s.emphasis ? 4.5 : 3} />
                </g>
              );
            })}
            {/* Each line named at its right end, where the pair chart prints
               its two prices: the price, then the option. */}
            {dodge(
              drawnSeries.map(s => ({ key: s.id, at: y(s.consensus), s })),
              PAD_T + 4,
              H - PAD_B - 4,
            ).map(l => {
              const sx = x(settleT);
              const moved = Math.abs(l.y - l.at) > 4;
              return (
                <g key={l.key}>
                  {moved && <line className="nchart-leader" x1={sx - 6} x2={sx - 34} y1={l.at} y2={l.y} />}
                  <text
                    className={`nchart-series-label${l.s.emphasis ? ' is-selected' : ''}`}
                    x={sx - (moved ? 38 : 9)}
                    y={l.y + 4}
                    textAnchor="end"
                  >
                    {`${fmt(l.s.consensus, unit)} ${l.s.label}`}
                  </text>
                </g>
              );
            })}
          </g>
        )}
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
      {optionMode && (
        <div className="nchart-legend" aria-label="Legend">
          {drawnSeries.map(s => (
            <span key={s.id} className={s.emphasis ? 'is-selected' : undefined}>
              <i className="nchart-legend-line nchart-legend-line--option" />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {!optionMode && !legend && marksLegend && (
        <div className="nchart-legend" aria-label="Legend">
          <span>
            <i className="nchart-legend-line" />
            actual
          </span>
          <span>
            <i className="nchart-legend-dot nchart-legend-dot--now" />
            market's call for {forecastDayOf(selectedResolvesOn)}
          </span>
          {markers.some(m => !m.selected) && (
            <span>
              <i className="nchart-legend-dot nchart-legend-dot--other" />
              other open dates
            </span>
          )}
        </div>
      )}
      {!optionMode && legend && (
        <div className="nchart-legend" aria-label="Legend">
          <span>
            <i className="nchart-legend-dot nchart-legend-dot--approved" />
            {legend.approved}
          </span>
          <span>
            <i className="nchart-legend-dot nchart-legend-dot--declined" />
            {legend.declined}
          </span>
          <span>
            <i className="nchart-legend-dot nchart-legend-dot--now" />
            the market now
          </span>
        </div>
      )}
      {tip && (
        <div className={`mchart-tip${tip.x > W * 0.6 ? ' is-right' : ''}`} style={{ left: `${(tip.x / W) * 100}%` }}>
          <div className="mchart-tip-date">{tip.date}</div>
          <div>
            {tip.label} <span className="mchart-tip-v">{tip.value}</span>
          </div>
          {tip.extra?.map(e => (
            <div key={`${e.tone}-${e.label}`} className={`nchart-tip-${e.tone}`}>
              {e.label} <span className="mchart-tip-v">{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
