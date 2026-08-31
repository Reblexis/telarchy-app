import { type CSSProperties, type ReactNode, useState } from 'react';
import { compactValueOf } from '../lib/floor-horizons';
import { formatMetricValue } from '../lib/market-quote';

/**
 * The payoff line (docs/ui-conventions.md, "The payoff line is drawn").
 *
 * What a bet is worth wherever the number lands, drawn. Payout is linear in
 * the settled value, so the bet IS a straight line: where it crosses zero is
 * the break-even, its slope is what each further point pays, and its two ends
 * are the most it can lose and the most it can make. Nothing else on the
 * ticket says any of that, and the rows that used to try said it four times
 * over in a table the owner could not read.
 *
 * The thing it exists to show is that the break-even sits SHORT of the value
 * the bet pushes the market to, because buying walks the price and the shares
 * cost the average of the walk. On the line that is simply the order of the
 * two guides, which is why the picture works where two fact rows did not: the
 * trader who could not see it read an overshoot as a total loss and asked an
 * operator in a chat window (notes/quroe-churn-2026-08-27.md).
 *
 * Hovering reads out any point on it, which is the question a scale of fixed
 * stops could only answer at four places.
 *
 * Colours come from the app's own tokens through CSS classes, never from
 * attributes, so the whole picture follows the light and dark themes.
 */

/** The plot's height in px, which is also the SVG's own vertical unit: the
    viewBox is 100 wide by this tall and does NOT preserve its aspect, so x
    reads as a percentage of the range and y reads as pixels. Every stroke
    carries `vector-effect` so the sideways scaling never thickens it. */
const PLOT_H = 84;
/** Headroom above and below the line's ends, for their own labels. */
const PAD = 13;

interface Props {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  /** Where the market stands right now. */
  consensus: number;
  /** The side this is about; null is an untouched ticket, which has no bet
      to draw and shows the plain range bar instead. */
  direction: 'higher' | 'lower' | null;
  /** The settled value at which the bet, or the held position, breaks even. */
  breakeven: number | null;
  /** Where the composed bet would leave the market. Null when nothing is
      being pushed: a resting limit order, or a position already held. */
  push: number | null;
  /** The shares the bet buys (or the position holds) and what they cost,
      which is all the drawing needs: payout is linear in the settled value. */
  shares: number | null;
  spend: number | null;
  /** The value the bet lands on, rendered by the ticket because it is an
      input a trader types a target into. */
  pushLabel?: ReactNode;
}

/**
 * A label sits over its own guide, so near the ends of the range a centred
 * one would hang off the card. Inside the middle it is centred; past that it
 * pins to the edge it is nearest and reads inward from there.
 */
function labelStyle(pct: number): CSSProperties {
  if (pct < 14) return { left: 0 };
  if (pct > 86) return { right: 0 };
  return { left: `${pct}%`, transform: 'translateX(-50%)' };
}

export function PayoffLine({
  unit,
  rangeMin,
  rangeMax,
  consensus,
  direction,
  breakeven,
  push,
  shares,
  spend,
  pushLabel,
}: Props) {
  /** Where the pointer is reading, as a fraction of the range. */
  const [read, setRead] = useState<number | null>(null);

  const span = rangeMax - rangeMin;
  if (!(span > 0) || !Number.isFinite(consensus)) return null;

  /** Two decimals, so a guide and the label naming it land on the same
      number rather than on two roundings of it. */
  const pct = (v: number) => Math.round(Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100)) * 100) / 100;
  const money = (v: number) => `${unit}${formatMetricValue(v)}`;
  const credits = (v: number) => {
    const n = Math.round(v);
    return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')} cr`;
  };
  const nowPct = pct(consensus);
  const priced =
    direction !== null && breakeven !== null && shares !== null && spend !== null && shares > 0 && spend > 0;

  // Nothing composed: the range, and where the market sits in it. A share
  // bought this second breaks even exactly there, which is the only honest
  // thing to say before a stake exists.
  if (!priced) {
    return (
      <div className="pay">
        <div className="pay-track-wrap">
          <div className="pay-track">
            <div className="pay-win pay-win--lower" style={{ left: '0%', right: `${100 - nowPct}%` }} />
            <div className="pay-win pay-win--higher" style={{ left: `${nowPct}%`, right: '0%' }} />
          </div>
          <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} title={`Now ${money(consensus)}`} />
        </div>
        <div className="pay-ends">
          <span>{money(rangeMin)}</span>
          <span>{money(rangeMax)}</span>
        </div>
      </div>
    );
  }

  /** Credits won or lost if the number settles at `v`. */
  const worthAt = (v: number): number => {
    const f = (v - rangeMin) / span;
    return (shares as number) * (direction === 'higher' ? f : 1 - f) - (spend as number);
  };

  const atMin = worthAt(rangeMin);
  const atMax = worthAt(rangeMax);
  const lo = Math.min(atMin, atMax);
  const hi = Math.max(atMin, atMax);
  const yOf = (c: number) => PAD + ((hi - c) * (PLOT_H - 2 * PAD)) / (hi - lo);
  const yZero = yOf(0);
  const bePct = pct(breakeven as number);
  const pushPct = push === null ? null : pct(push);

  const leftUp = atMin > 0;
  const readValue = read === null ? null : rangeMin + read * span;
  const readWorth = readValue === null ? null : worthAt(readValue);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // A plot with no width on screen (an unmounted measure, a hidden card)
    // would otherwise divide by zero and read out NaN.
    if (!(r.width > 0)) return;
    setRead(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };

  return (
    <div className="pay">
      <div className="pay-y">
        <span className={atMin < atMax ? 'pay-y--lo' : 'pay-y--hi'}>{credits(atMin)}</span>
        <span className={atMin < atMax ? 'pay-y--hi' : 'pay-y--lo'}>{credits(atMax)}</span>
      </div>

      <div
        className={`pay-plot${read === null ? '' : ' is-reading'}`}
        style={{ height: `${PLOT_H}px` }}
        onPointerMove={onMove}
        onPointerLeave={() => setRead(null)}
      >
        <svg
          className="pay-svg"
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`What this bet is worth at settlement: ${credits(atMin)} at ${money(
            rangeMin,
          )}, nothing at ${money(breakeven as number)}, ${credits(atMax)} at ${money(rangeMax)}`}
        >
          <polygon
            className={`pay-fill pay-fill--${leftUp ? 'up' : 'down'}`}
            points={`0,${yOf(atMin)} ${bePct},${yZero} 0,${yZero}`}
          />
          <polygon
            className={`pay-fill pay-fill--${leftUp ? 'down' : 'up'}`}
            points={`${bePct},${yZero} 100,${yOf(atMax)} 100,${yZero}`}
          />
          <line className="pay-zero" x1="0" y1={yZero} x2="100" y2={yZero} vectorEffect="non-scaling-stroke" />
          <line
            className="pay-guide pay-guide--now"
            data-at={String(nowPct)}
            x1={nowPct}
            y1="0"
            x2={nowPct}
            y2={PLOT_H}
            vectorEffect="non-scaling-stroke"
          />
          {pushPct !== null && (
            <line
              className="pay-guide pay-guide--new"
              data-at={String(pushPct)}
              x1={pushPct}
              y1="0"
              x2={pushPct}
              y2={PLOT_H}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            className="pay-curve"
            data-from={String(atMin)}
            data-to={String(atMax)}
            x1="0"
            y1={yOf(atMin)}
            x2="100"
            y2={yOf(atMax)}
            vectorEffect="non-scaling-stroke"
          />
          {read !== null && readWorth !== null && (
            <line
              className="pay-cursor"
              x1={read * 100}
              y1="0"
              x2={read * 100}
              y2={PLOT_H}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* The crossing, which is the break-even, as a dot on the line. An
            SVG circle would be an ellipse: the viewBox does not preserve
            its aspect, so anything round is HTML. */}
        <div
          className={`pay-be pay-be--${direction}`}
          data-at={String(bePct)}
          data-worth="0"
          style={{ left: `${bePct}%`, top: `${yZero}px` }}
          title={`Breaks even at ${money(breakeven as number)}`}
        />
        {read !== null && readWorth !== null && (
          <div className="pay-dot" style={{ left: `${read * 100}%`, top: `${yOf(readWorth)}px` }} />
        )}

        <div className="pay-now" data-at={String(nowPct)} style={{ ...labelStyle(nowPct), bottom: 0 }}>
          now {money(consensus)}
        </div>
        {pushPct !== null && pushLabel !== undefined && (
          <div className="pay-new" data-at={String(pushPct)} style={{ ...labelStyle(pushPct), top: 0 }}>
            <span className="pay-new-k">new value</span> <span className="pay-new-v">{pushLabel}</span>
          </div>
        )}

        {/* The readout sits on the far side of zero from the point it names,
            so it never covers the line it is reading. */}
        {read !== null && readValue !== null && readWorth !== null && (
          <div
            className="pay-read"
            data-at={String(Math.round(read * 10000) / 100)}
            data-side={readWorth > 0 ? 'under' : 'over'}
            style={
              readWorth > 0
                ? { ...labelStyle(read * 100), top: `${yZero + 5}px` }
                : { ...labelStyle(read * 100), bottom: `${PLOT_H - yZero + 5}px` }
            }
          >
            <span className="pay-read-v">{money(readValue)}</span>
            <span className={`pay-read-c ${readWorth > 0 ? 'is-up' : readWorth < 0 ? 'is-down' : ''}`}>
              {credits(readWorth)}
            </span>
          </div>
        )}
      </div>

      <div className="pay-axis">
        <span>{compactValueOf(rangeMin, unit)}</span>
        <span className="pay-axis-be" style={labelStyle(bePct)}>
          {compactValueOf(breakeven as number, unit)}
        </span>
        <span>{compactValueOf(rangeMax, unit)}</span>
      </div>
    </div>
  );
}
