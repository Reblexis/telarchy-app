import { formatMetricValue } from '../lib/market-quote';

/**
 * The payoff line (docs/ui-conventions.md, "The payoff line puts those
 * numbers in an order").
 *
 * One track for the market's range, carrying the numbers the money turns on
 * in the order they actually sit: where the market is now, where the bet
 * breaks even, and where the bet pushes the market to. Buying walks the
 * price, so the shares cost the average of the walk and the break-even
 * always lands SHORT of the push. Two unrelated fact rows never made that
 * visible, and the trader who could not see it read an overshoot as a total
 * loss and asked an operator in a chat window instead
 * (notes/quroe-churn-2026-08-27.md).
 *
 * It carries no words. Every number on it is named by the fact rows
 * directly underneath, so a caption would say them twice, and captions over
 * a track are what made the card too tall to read (owner, 2026-08-31: "this
 * is too tall now and definitely dont put here the x room to be wrong").
 * The picture's whole job is the ORDER, which needs no text. The range ends
 * are the exception, and only while the ticket is untouched: there they
 * replace the sentence about what a share pays, and nothing else in that
 * state states the range.
 */
interface Props {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  /** Where the market stands right now. */
  consensus: number;
  /** The side this is about; null is an untouched ticket, which has no bet
      to draw and marks only the market. */
  direction: 'higher' | 'lower' | null;
  /** The settled value at which the bet, or the held position, breaks even. */
  breakeven: number | null;
  /** Where the composed bet would leave the market. Null when nothing is
      being pushed: a resting limit order, or a position already held. */
  push: number | null;
}

export function PayoffLine({ unit, rangeMin, rangeMax, consensus, direction, breakeven, push }: Props) {
  const span = rangeMax - rangeMin;
  if (!(span > 0) || !Number.isFinite(consensus)) return null;

  const pct = (v: number) => Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100));
  const money = (v: number) => `${unit}${formatMetricValue(v)}`;
  const nowPct = pct(consensus);
  const resting = direction === null || breakeven === null;

  return (
    <div className="pay">
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
        {/* Marks live outside the clipped track so they stand proud of it.
            The titles are the only naming they get, for a mouse that pauses. */}
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
      {resting && (
        <div className="pay-ends">
          <span>{money(rangeMin)}</span>
          <span>{money(rangeMax)}</span>
        </div>
      )}
    </div>
  );
}
