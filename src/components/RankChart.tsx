import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState } from 'react';

/**
 * The page's second and last drawing: a value per ranked unit.
 *
 * Spec: docs/data-room.md, "How the page draws things". Two questions on this
 * page are not histories and no time series answers them: what each verified
 * participant has traded this week, and what each participant is up or down.
 * Both are really one question, "who is near the line the count is drawn at",
 * and the answer is the whole distribution: no grouping, no top ten, and a
 * zero keeps its slot, because a count ("four are between 40 and 99") throws
 * the shape away.
 *
 * It shares TimeChart's idiom on purpose - the same axis style, the same
 * threshold rule, the same crosshair, the same panel under the chart - so a
 * reader who has hovered one has learned the other. What a tall tail would
 * otherwise cost is the near-threshold detail, which is the part a forecaster
 * is actually pricing, so the axis caps and every value past it is printed
 * underneath in full. Nothing is clipped in silence.
 */

interface Props {
  /** Names the drawing for a reader scoping to it (tests, and the page's own
   *  styling); the bars themselves stay anonymous. */
  id: string;
  values: number[];
  /** The line the count is drawn at, marked and named. */
  threshold: number;
  /** Where the axis stops; values past it are printed instead. */
  cap: number;
  unit: string;
  label: string;
  /** True where a value can be negative (profit), so zero is a mid-line. */
  signed?: boolean;
  caption?: ReactNode;
  height?: number;
}

const W = 760;
const PAD_L = 44;
const PAD_T = 16;
const PAD_B = 16;

/** Three-ish ticks on round numbers, the same axis TimeChart draws. */
function ticksFor(lo: number, hi: number): number[] {
  const mag = 10 ** Math.floor(Math.log10((hi - lo || 1) / 3));
  const at = (step: number) => {
    const out: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + step / 1000; t += step) out.push(Number(t.toFixed(6)));
    return out;
  };
  const good = [1, 2, 2.5, 5, 10, 20]
    .map(k => k * mag)
    .map(at)
    .filter(t => t.length >= 3 && t.length <= 6);
  return good[0] ?? [lo, hi];
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');

/**
 * A value as the reader should see it beside the line it is being judged
 * against. Two decimals is enough to read, except where rounding to two would
 * put the number ON the line or across it: 99.996 printed as 100 sits on a
 * line the count says it is under, and 100.004 printed as 100 claims a tie it
 * does not have. Those keep the digits it takes to be unambiguous.
 */
function atThreshold(v: number, threshold: number): string {
  const short = Math.round(v * 100) / 100;
  const misleading = short === threshold && v !== threshold;
  const crossed = v < threshold !== short < threshold;
  return crossed || misleading
    ? v.toLocaleString('en-US', { maximumFractionDigits: 20 })
    : short.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function RankChart({ id, values, threshold, cap, unit, label, signed = false, caption, height = 190 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (!values.length) {
    return (
      <p className="dr-empty" aria-label={label}>
        Nothing recorded yet.
      </p>
    );
  }

  const H = height;
  const hasNeg = values.some(v => v < 0);
  const top = Math.max(threshold * 1.25, Math.min(cap, Math.max(...values)));
  const bottom = hasNeg ? Math.min(-threshold / 2, Math.max(-cap, Math.min(...values))) : 0;
  const span = top - bottom || 1;
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + ((top - Math.max(bottom, Math.min(top, v))) / span) * plotH;
  const zeroY = y(0);
  const gap = values.length > 60 ? 1 : 3;
  const plotW = W - PAD_L;
  const w = Math.max(1, (plotW - gap * (values.length - 1)) / values.length);
  const past = values.filter(v => Math.abs(v) > cap);

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(values.length - 1, Math.floor((px - PAD_L) / (w + gap)))));
  };

  return (
    <figure className={`rchart${signed ? ' rchart--signed' : ''}`} data-rank={id}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="rchart-svg"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title>{label}</title>
        {ticksFor(bottom, top).map(t => (
          <g key={t}>
            <line className="tchart-grid" x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} />
            <text className="tchart-ylabel" x={PAD_L - 6} y={y(t) + 3} textAnchor="end">
              {n(t)}
            </text>
          </g>
        ))}
        <line x1={PAD_L} y1={zeroY} x2={W} y2={zeroY} className="rchart-zero" />
        {values.map((v, i) => {
          const x = PAD_L + i * (w + gap);
          const yv = y(v);
          const h = v === 0 ? 1.5 : Math.max(1.5, Math.abs(yv - zeroY));
          const yTop = v < 0 ? zeroY : Math.min(yv, zeroY - 1.5);
          return (
            <rect
              // Position is the identity here: the rows are anonymous numbers.
              key={`${id}-${i}`}
              x={x}
              y={yTop}
              width={w}
              height={h}
              className={`rchart-bar${v < 0 ? ' is-down' : ' is-up'}${hover === i ? ' is-on' : ''}`}
            />
          );
        })}
        <line x1={PAD_L} y1={y(threshold)} x2={W} y2={y(threshold)} className="rchart-threshold" />
      </svg>

      <div className="tchart-tip-slot">
        {hover !== null && (
          <div className="tchart-tip" role="status">
            <span className="tchart-tip-day">
              {hover + 1} of {values.length}
            </span>
            <span className="tchart-tip-row">
              {atThreshold(values[hover], threshold)} {unit}
            </span>
            <span className={values[hover] >= threshold ? 'tchart-tip-over' : 'tchart-tip-row'}>
              {values[hover] >= threshold ? 'over the line' : 'under the line'}
            </span>
          </div>
        )}
      </div>

      <figcaption className="tchart-cap">
        {caption}
        <span className="rchart-line">{`${n(threshold)} ${unit} counts`}</span>
      </figcaption>
      {past.length > 0 && (
        <p className="rchart-over">
          Past the axis: {past.map(v => n(v)).join(', ')} {unit}
        </p>
      )}
    </figure>
  );
}
