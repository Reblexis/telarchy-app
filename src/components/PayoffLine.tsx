import type { CSSProperties, ReactNode } from 'react';
import { compactValueOf } from '../lib/floor-horizons';
import { formatMetricValue } from '../lib/market-quote';

/**
 * The payoff line (docs/ui-conventions.md, "The payoff line puts those
 * numbers in an order").
 *
 * The whole answer to "what happens to my money", in a picture. One track
 * for the market's range carrying the three values in the order they sit,
 * the market, the break-even and where the bet leaves the market; under it,
 * what the bet is worth at a handful of settlement values marked along that
 * same range.
 *
 * Buying walks the price, so the shares cost the average of the walk and the
 * break-even always lands SHORT of the push. That is the thing a trader has
 * to see and never could: stated as two unrelated fact rows, the one who
 * could not see it read an overshoot as a total loss, asked at what point
 * his shares stop paying out, and got the answer from an operator in a chat
 * window (notes/quroe-churn-2026-08-27.md). Here it is the stop that reads
 * "0 cr", which is a stop like any other and not a note beside them (owner,
 * 2026-08-31: "the 0 credit profit point should be just like any other..
 * among the other ones.. not separate").
 *
 * This REPLACES the four fact rows it was drawn above, which is why the
 * pushed-to value is the one caption: it is also the input a trader types a
 * target into, and the picture had to keep it.
 */

/** The settlement values every scale offers, before the break-even claims
    its own place among them. */
const QUARTERS = [0, 0.25, 0.5, 0.75, 1];
/** How close two stops may come before one of them is not worth drawing.
    A label is about a seventh of the track wide, so this is the point at
    which two of them would touch. */
const MIN_GAP = 0.14;

interface Props {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  /** Where the market stands right now. */
  consensus: number;
  /** The side this is about; null is an untouched ticket, which has no bet
      to price and marks only the market. */
  direction: 'higher' | 'lower' | null;
  /** The settled value at which the bet, or the held position, breaks even. */
  breakeven: number | null;
  /** Where the composed bet would leave the market. Null when nothing is
      being pushed: a resting limit order, or a position already held. */
  push: number | null;
  /** The shares the bet buys (or the position holds) and what they cost,
      which is all the scale needs: payout is linear in the settled value. */
  shares: number | null;
  spend: number | null;
  /** The pushed-to value, rendered by the ticket because it is an input. */
  pushLabel?: ReactNode;
}

/**
 * A label sits over its own point on the track, so near the ends a centred
 * one would hang off the card. Past the outer eighth it pins to the edge it
 * is nearest and reads inward from there.
 */
function labelStyle(pct: number): CSSProperties {
  if (pct < 12) return { left: 0 };
  if (pct > 88) return { right: 0 };
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
  const span = rangeMax - rangeMin;
  if (!(span > 0) || !Number.isFinite(consensus)) return null;

  /** Two decimals, so a mark and the stop that names it land on the same
      number rather than on two roundings of it. */
  const pct = (v: number) => Math.round(Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100)) * 100) / 100;
  const money = (v: number) => `${unit}${formatMetricValue(v)}`;
  const nowPct = pct(consensus);
  const resting = direction === null || breakeven === null;
  const priced = !resting && shares !== null && spend !== null && shares > 0 && spend > 0;

  /** Credits won or lost if the number settles at `v`. Payout is linear, so
      a share is worth its position in the range and nothing else. */
  const worthAt = (v: number): number => {
    const f = (v - rangeMin) / span;
    return (shares ?? 0) * (direction === 'higher' ? f : 1 - f) - (spend ?? 0);
  };
  /** Credits, said as credits: without the unit a stop reads as another
      metric value rather than as the money at stake. */
  const credits = (v: number): string => {
    const n = Math.round(v);
    return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')} cr`;
  };

  /* The break-even takes a place in the row rather than a note beside it, so
     it displaces whichever quarter it stands too close to. */
  const beFraction = breakeven === null ? 0 : Math.min(1, Math.max(0, (breakeven - rangeMin) / span));
  const stops = priced
    ? [...QUARTERS.filter(q => Math.abs(q - beFraction) >= MIN_GAP), beFraction]
        .sort((a, b) => a - b)
        .map(f => {
          const v = rangeMin + f * span;
          return { at: pct(v), value: v, worth: worthAt(v) };
        })
    : [];

  return (
    <div className="pay">
      {push !== null && pushLabel !== undefined && (
        <div className="pay-push" style={{ textAlign: pct(push) > 55 ? 'right' : 'left' }}>
          push {pushLabel}
        </div>
      )}
      <div className="pay-track-wrap">
        <div className="pay-track">
          {resting ? (
            <>
              <div className="pay-win pay-win--lower" style={{ left: '0%', right: `${100 - nowPct}%` }} />
              <div className="pay-win pay-win--higher" style={{ left: `${nowPct}%`, right: '0%' }} />
            </>
          ) : (
            <div
              className={`pay-win pay-win--${direction}`}
              style={
                direction === 'higher'
                  ? { left: `${pct(breakeven)}%`, right: '0%' }
                  : { left: '0%', right: `${100 - pct(breakeven)}%` }
              }
            />
          )}
          {/* Every stop is a point ON the track, so the row below reads as
              the track's own scale rather than as a table beside it. */}
          {stops.map(s => (
            <div key={s.at} className="pay-tick" style={{ left: `${s.at}%` }} />
          ))}
        </div>
        <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} title={`Now ${money(consensus)}`} />
        {!resting && (
          <div
            className={`pay-mark pay-mark--be-${direction}`}
            style={{ left: `${pct(breakeven)}%` }}
            title={`Breaks even at ${money(breakeven)}`}
          />
        )}
        {push !== null && !resting && (
          <div
            className="pay-mark pay-mark--push"
            style={{ left: `${pct(push)}%` }}
            title={`Leaves the market at ${money(push)}`}
          />
        )}
      </div>

      {priced ? (
        <div className="pay-stops" aria-label="What this bet is worth at settlement">
          {stops.map(s => (
            <div key={s.at} className="pay-stop" data-at={String(s.at)} style={labelStyle(s.at)}>
              <u>{compactValueOf(s.value, unit)}</u>
              <b className={s.worth > 0 ? 'up' : s.worth < 0 ? 'down' : 'even'}>{credits(s.worth)}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="pay-ends">
          <span>{money(rangeMin)}</span>
          <span>{money(rangeMax)}</span>
        </div>
      )}
    </div>
  );
}
