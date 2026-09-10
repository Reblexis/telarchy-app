import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useRef, useState } from 'react';

/**
 * The data room's one chart: a number with a history, drawn over time.
 *
 * Spec: docs/data-room.md, "How the page draws things". Every published
 * series on the page goes through this so they read as one instrument: the
 * same grid, the same date axis, the same crosshair, the same tooltip. A
 * forecaster is pricing where a number goes next, and a shape over time is
 * the only drawing that answers that.
 *
 * Three rules it enforces for everything drawn through it:
 *
 * - **A gap is a gap.** Consecutive points more than `gapDays` apart start a
 *   new line rather than being joined, because a day nobody measured and a
 *   day the number did not move are different facts (the same rule the weekly
 *   readings keep by publishing null).
 * - **Events are marks, never numbers.** The dated things the owner did are
 *   ticks on the day they happened, numbered against the list the page prints
 *   beneath. No figure is attached to one: what the number did afterwards is
 *   the line they stand on.
 * - **The pointer always answers.** Hover puts a crosshair on the nearest day
 *   and names that day, every series' value there, and any event on it.
 */

export interface TimePoint {
  /** ISO date or instant; the day is what is drawn. */
  at: string;
  value: number;
}

export interface TimeSeries {
  key: string;
  label: string;
  points: TimePoint[];
  /** 'line' (default) fills nothing; 'area' shades under it; 'bars' is a
   *  count per day, where a gap genuinely means none. */
  kind?: 'line' | 'area' | 'bars';
  /**
   * True for a series that is DEFINED between its points, such as a running
   * total: it never breaks on a quiet stretch, because nothing was missing
   * there. A reading is not defined between readings and must not set this.
   */
  connect?: boolean;
}

export interface TimeEvent {
  at: string;
  kind: string;
  label: string;
}

interface Props {
  series: TimeSeries[];
  /** What the chart is, for a screen reader and for the empty state. */
  label: string;
  events?: TimeEvent[];
  /** Prepended to every value ("$"), for money series. */
  unit?: string;
  height?: number;
  /** Days between two readings past which the line breaks. */
  gapDays?: number;
  /**
   * 'log' for a heavy-tailed count (credits traded, where one day is three
   * orders of magnitude above the rest): a linear axis puts every ordinary
   * day on the floor and answers nothing. The axis is labelled in powers so
   * the compression is stated rather than hidden, and the caption should say
   * so in words too.
   */
  scale?: 'linear' | 'log';
  /** A caption under the chart, in the page's quiet register. */
  caption?: ReactNode;
  /**
   * 'spark' is the same chart with its axes turned off, for the desk strip's
   * tiles (docs/data-room.md, "The desk"): no grid, no labels, no event
   * marks, because a 40px band has no room for them. The crosshair and the
   * panel stay, because a drawing a reader cannot interrogate is a claim.
   */
  variant?: 'full' | 'spark';
}

const W = 760;
const FULL_PAD = { l: 44, r: 12, t: 36, b: 26 };
const SPARK_PAD = { l: 4, r: 5, t: 7, b: 6 };
const DAY_MS = 24 * 60 * 60 * 1000;

const dayOf = (iso: string) => iso.slice(0, 10);
const tOf = (iso: string) => new Date(`${dayOf(iso)}T00:00:00Z`).getTime();

/** "Aug 22", the register every date on the page uses. */
function dayLabel(iso: string): string {
  const d = new Date(`${dayOf(iso)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Compact enough for an axis: 1,200 -> 1.2k, 0.5 -> 0.5. */
function fmtValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${unit}${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${unit}${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (abs >= 10 || Number.isInteger(v)) return `${unit}${Math.round(v).toLocaleString('en-US')}`;
  return `${unit}${Math.round(v * 100) / 100}`;
}

/** Powers of ten up to the top of a log axis: 1, 10, 100, 1k, ... */
function logTicks(hi: number): number[] {
  const out: number[] = [];
  for (let p = 0; 10 ** p <= Math.max(1, hi); p++) out.push(10 ** p);
  return out.length >= 2 ? out : [1, Math.max(10, hi)];
}

/** Three-ish ticks on round numbers, so an axis reads 5 / 10 / 15. */
function ticksFor(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const mag = 10 ** Math.floor(Math.log10(span / 3));
  const at = (step: number) => {
    const out: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + step / 1000; t += step) out.push(Number(t.toFixed(6)));
    return out;
  };
  // The finest step that still leaves an axis a reader can scan: three to
  // five labels. Taking the first step wider than span/3 gave two on a range
  // of seventeen, which is a top and a bottom and nothing to read against.
  const candidates = [1, 2, 2.5, 5, 10, 20].map(k => k * mag);
  const good = candidates.map(at).filter(t => t.length >= 3 && t.length <= 6);
  return good[0] ?? at(candidates[candidates.length - 1]);
}

export function TimeChart({
  series,
  label,
  events = [],
  unit = '',
  height = 200,
  gapDays = 3,
  scale = 'linear',
  caption,
  variant = 'full',
}: Props) {
  const spark = variant === 'spark';
  const { l: PAD_L, r: PAD_R, t: PAD_T, b: PAD_B } = spark ? SPARK_PAD : FULL_PAD;
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursorT, setCursorT] = useState<number | null>(null);

  const H = height;
  const drawn = series.filter(s => s.points.length > 0);

  const model = useMemo(() => {
    const all = drawn.flatMap(s => s.points.map(p => ({ t: tOf(p.at), v: p.value })));
    if (all.length === 0) return null;
    const t0 = Math.min(...all.map(p => p.t));
    const t1 = Math.max(...all.map(p => p.t));
    const lo = spark ? Math.min(...all.map(p => p.v)) : Math.min(0, ...all.map(p => p.v));
    const hi = Math.max(...all.map(p => p.v));
    // A flat series still needs a band to sit in rather than a line on the floor.
    const pad = (hi - lo || Math.max(1, Math.abs(hi))) * 0.15;
    // A spark shows SHAPE, not level: it is 38px tall beside the figure it
    // belongs to, so it uses the series' own range and pads both ends. A
    // full-size chart keeps its zero, because there the axis is the point.
    if (spark) return { t0, t1, y0: lo - pad, y1: hi + pad };
    return { t0, t1, y0: lo - (lo < 0 ? pad : 0), y1: hi + pad };
  }, [drawn, spark]);

  if (!model) {
    return (
      <p className="dr-empty" aria-label={label}>
        Nothing recorded yet.
      </p>
    );
  }

  const { t0, t1, y0, y1 } = model;
  // On a log axis a value sits at log10(v + 1), so zero has a place (the
  // floor) and 20 and 40 are a readable distance apart.
  const lg = (v: number) => Math.log10(Math.max(0, v) + 1);
  const x = (t: number) =>
    t1 === t0 ? (W - PAD_L - PAD_R) / 2 + PAD_L : PAD_L + ((t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    scale === 'log'
      ? PAD_T + (1 - lg(v) / (lg(y1) || 1)) * (H - PAD_T - PAD_B)
      : PAD_T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PAD_T - PAD_B);

  // One polyline per unbroken run: a hole in the readings is a hole in the line.
  const runsOf = (s: TimeSeries) => {
    const sorted = [...s.points].sort((a, b) => tOf(a.at) - tOf(b.at));
    const runs: Array<Array<{ t: number; v: number }>> = [];
    let run: Array<{ t: number; v: number }> = [];
    for (const p of sorted) {
      const t = tOf(p.at);
      if (!s.connect && run.length && t - run[run.length - 1].t > gapDays * DAY_MS) {
        runs.push(run);
        run = [];
      }
      run.push({ t, v: p.value });
    }
    if (run.length) runs.push(run);
    return runs;
  };

  const days = [...new Set(drawn.flatMap(s => s.points.map(p => dayOf(p.at))))].sort();
  const eventsInWindow = [...events]
    .map(e => ({ ...e, t: tOf(e.at) }))
    .sort((a, b) => a.t - b.t)
    .map((e, i) => ({ ...e, n: i + 1 }))
    .filter(e => e.t >= t0 && e.t <= t1);

  // A badge needs room: twelve decisions in a fortnight on a four-month axis
  // would print twelve numbers on top of each other. The first mark in a
  // crowd is numbered, the rest keep their rule, and the pointer names every
  // one of them (docs/data-room.md, "The line carries what happened to it").
  let lastBadge = -Infinity;
  const badged = new Set<string>();
  for (const e of eventsInWindow) {
    if (x(e.t) - lastBadge < 17) continue;
    lastBadge = x(e.t);
    badged.add(`${e.at}-${e.kind}`);
  }

  const nearest =
    cursorT === null
      ? null
      : days.reduce((best, d) => (Math.abs(tOf(d) - cursorT) < Math.abs(tOf(best) - cursorT) ? d : best), days[0]);

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD_L) / (W - PAD_L - PAD_R);
    setCursorT(t0 + Math.max(0, Math.min(1, frac)) * (t1 - t0));
  };

  const barW = Math.max(1, (W - PAD_L - PAD_R) / Math.max(1, days.length) - 1);
  const zeroY = y(Math.max(y0, 0));

  return (
    <figure className={spark ? 'tchart tchart--spark' : 'tchart'}>
      {!spark && drawn.length > 1 && (
        <div className="tchart-legend">
          {drawn.map((s, i) => (
            <span key={s.key} className="tchart-legend-item">
              <span className={`tchart-swatch is-s${i}`} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={spark ? 'tchart-svg is-spark' : 'tchart-svg'}
        style={{ height }}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setCursorT(null)}
      >
        <title>{label}</title>
        {!spark &&
          (scale === 'log' ? logTicks(y1) : ticksFor(y0, y1)).map(t => (
            <g key={t}>
              <line className="tchart-grid" x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} />
              <text className="tchart-ylabel" x={PAD_L - 6} y={y(t) + 3} textAnchor="end">
                {fmtValue(t, unit)}
              </text>
            </g>
          ))}

        {!spark &&
          eventsInWindow.map(e => (
            <g key={`${e.at}-${e.kind}`} className={`tchart-event is-${e.kind}`}>
              <title>{e.label}</title>
              <line
                className="tchart-event-rule"
                x1={x(e.t)}
                x2={x(e.t)}
                y1={badged.has(`${e.at}-${e.kind}`) ? PAD_T - 18 : PAD_T - 4}
                y2={H - PAD_B}
              />
              {badged.has(`${e.at}-${e.kind}`) && (
                <>
                  <circle className="tchart-event-dot" cx={x(e.t)} cy={PAD_T - 18} r={7} />
                  <text className="tchart-event-num" x={x(e.t)} y={PAD_T - 14.5} textAnchor="middle">
                    {e.n}
                  </text>
                </>
              )}
            </g>
          ))}

        {drawn.map((s, i) =>
          s.kind === 'bars' ? (
            <g key={s.key} className={`tchart-bars is-s${i}`}>
              {s.points.map(p => {
                const h = Math.max(1, Math.abs(zeroY - y(p.value)));
                return (
                  <rect
                    key={p.at}
                    x={x(tOf(p.at)) - barW / 2}
                    y={Math.min(y(p.value), zeroY)}
                    width={barW}
                    height={h}
                  />
                );
              })}
            </g>
          ) : (
            <g key={s.key} className={`tchart-series is-s${i}`}>
              {runsOf(s).map(run => (
                <g key={`${s.key}-${run[0].t}`}>
                  {s.kind === 'area' && run.length > 1 && (
                    <polygon
                      className="tchart-area"
                      points={`${x(run[0].t)},${zeroY} ${run.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} ${x(run[run.length - 1].t)},${zeroY}`}
                    />
                  )}
                  <polyline className="tchart-line" points={run.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} />
                </g>
              ))}
              {!spark &&
                s.points.length <= 40 &&
                s.points.map(p => (
                  <circle key={p.at} className="tchart-dot" cx={x(tOf(p.at))} cy={y(p.value)} r={2.5} />
                ))}
              {/* A spark carries one dot, on the reading the figure beside it
                  is: where the line ends is the number. */}
              {spark && s.points.length > 0 && (
                <circle
                  className="tchart-dot"
                  cx={x(tOf(s.points[s.points.length - 1].at))}
                  cy={y(s.points[s.points.length - 1].value)}
                  r={2.6}
                />
              )}
            </g>
          ),
        )}

        {nearest && (
          <g className="tchart-cursor">
            <line x1={x(tOf(nearest))} x2={x(tOf(nearest))} y1={PAD_T - 4} y2={H - PAD_B} />
            {drawn.map(s => {
              const p = s.points.find(q => dayOf(q.at) === nearest);
              return p ? (
                <circle key={s.key} cx={x(tOf(nearest))} cy={y(p.value)} r={4} className="tchart-cursor-dot" />
              ) : null;
            })}
          </g>
        )}

        {!spark && (
          <>
            <text className="tchart-xlabel" x={PAD_L} y={H - 8} textAnchor="start">
              {dayLabel(days[0])}
            </text>
            <text className="tchart-xlabel" x={W - PAD_R} y={H - 8} textAnchor="end">
              {dayLabel(days[days.length - 1])}
            </text>
          </>
        )}
      </svg>

      {nearest && (
        <div className="tchart-tip" role="status">
          <span className="tchart-tip-day">{dayLabel(nearest)}</span>
          {drawn.map(s => {
            const p = s.points.find(q => dayOf(q.at) === nearest);
            return (
              <span key={s.key} className="tchart-tip-row">
                {s.label}: {p ? fmtValue(p.value, unit) : 'no reading'}
              </span>
            );
          })}
          {eventsInWindow
            .filter(e => dayOf(e.at) === nearest)
            .map(e => (
              <span key={`${e.at}-${e.kind}`} className="tchart-tip-event">
                {e.n}. {e.label}
              </span>
            ))}
        </div>
      )}

      {caption && <figcaption className="tchart-cap">{caption}</figcaption>}
    </figure>
  );
}
