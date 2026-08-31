import type { ReactNode } from 'react';
import { compactValueOf } from '../lib/floor-horizons';
import { formatMetricValue } from '../lib/market-quote';

/**
 * The payoff line (docs/ui-conventions.md, "The payoff line puts those
 * numbers in an order").
 *
 * The whole answer to "what happens to my money", in a picture. One track
 * for the market's range carrying the three values in the order they sit,
 * the market, the break-even and where the bet leaves the market; under it,
 * what the bet is worth at five settlement values spread across that range.
 *
 * Buying walks the price, so the shares cost the average of the walk and the
 * break-even always lands SHORT of the push. That is the thing a trader has
 * to see and never could: stated as two unrelated fact rows, the one who
 * could not see it read an overshoot as a total loss, asked at what point
 * his shares stop paying out, and got the answer from an operator in a chat
 * window (notes/quroe-churn-2026-08-27.md). Here the same fact is where the
 * red numbers turn green.
 *
 * This REPLACES the four fact rows it was drawn above (owner, 2026-08-31),
 * which is why the pushed-to value is the caption: it is also the input a
 * trader types a target into, and the picture had to keep it.
 */

/** The settlement values the scale prices: the ends and the quarters. */
const STOPS = [0, 0.25, 0.5, 0.75, 1];

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

  const pct = (v: number) => Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100));
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
  const credits = (v: number): string => {
    const n = Math.round(v);
    return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}`;
  };

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
        </div>
        {/* Marks live outside the clipped track so they stand proud of it. */}
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
        <div className="pay-scale" aria-label="What this bet is worth at settlement">
          {STOPS.map(s => {
            const v = rangeMin + s * span;
            const w = worthAt(v);
            return (
              <div key={s}>
                <u>{compactValueOf(v, unit)}</u>
                <b className={w >= 0 ? 'up' : 'down'}>{credits(w)}</b>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pay-ends">
          <span>{money(rangeMin)}</span>
          <span>{money(rangeMax)}</span>
        </div>
      )}
      {priced && <p className="pay-scale-cap">Credits won or lost, if it settles there.</p>}
    </div>
  );
}
