import type { CSSProperties } from 'react';
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
 * Every value is said ONCE, on its own mark. The sentence underneath names
 * the gap and nothing else, because a picture that repeats itself in prose
 * is the text this was meant to replace.
 */
interface Props {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  /** Where the market stands right now. */
  consensus: number;
  /** The side this is about; null is an untouched ticket, which has no bet
      to draw and so draws where each side would start paying instead. */
  direction: 'higher' | 'lower' | null;
  /** The settled value at which the bet, or the held position, breaks even. */
  breakeven: number | null;
  /** Where the composed bet would leave the market. Null when nothing is
      being pushed: a resting limit order, or a position already held. */
  push: number | null;
  /** `hold` states the distance the market may still travel; `compose`
      states the gap between the push and the break-even. */
  mode?: 'compose' | 'hold';
}

/**
 * A caption sits over its own mark, so near the ends of the range a centred
 * one would hang off the card. Inside the middle half it is centred; past
 * that it pins to the edge it is nearest and reads inward from there.
 */
function captionStyle(pct: number): CSSProperties {
  if (pct < 25) return { left: 0 };
  if (pct > 75) return { right: 0 };
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
  mode = 'compose',
}: Props) {
  const span = rangeMax - rangeMin;
  if (!(span > 0) || !Number.isFinite(consensus)) return null;

  const pct = (v: number) => Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100));
  const money = (v: number) => `${unit}${formatMetricValue(v)}`;
  const nowPct = pct(consensus);

  const ends = (
    <div className="pay-ends">
      <span>{money(rangeMin)}</span>
      <span>{money(rangeMax)}</span>
    </div>
  );

  // Untouched: a share bought this second breaks even at the value the market
  // is already at, which is the one honest thing to say before a stake exists.
  if (direction === null || breakeven === null) {
    return (
      <div className="pay">
        <div className="pay-cap">
          <span style={captionStyle(nowPct)}>
            now <b>{money(consensus)}</b>
          </span>
        </div>
        <div className="pay-track-wrap">
          <div className="pay-track">
            <div className="pay-win pay-win--lower" style={{ left: '0%', right: `${100 - nowPct}%` }} />
            <div className="pay-win pay-win--higher" style={{ left: `${nowPct}%`, right: '0%' }} />
          </div>
          <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} />
        </div>
        {ends}
        <div className="pay-sides">
          <span className="pay-side pay-side--lower">Lower wins</span>
          <span className="pay-side pay-side--higher">Higher wins</span>
        </div>
      </div>
    );
  }

  const bePct = pct(breakeven);
  const pushPct = push === null ? null : pct(push);
  const higher = direction === 'higher';
  const winStyle = higher ? { left: `${bePct}%`, right: '0%' } : { left: '0%', right: `${100 - bePct}%` };

  // Top row: the thing that moves. A resting order moves nothing, so it gets
  // no row at all rather than an empty one.
  const top =
    mode === 'hold'
      ? { at: nowPct, label: 'now', value: money(consensus) }
      : pushPct !== null && push !== null
        ? { at: pushPct, label: 'push', value: money(push) }
        : null;

  const say = (() => {
    if (mode === 'hold') {
      const gap = Math.abs(consensus - breakeven);
      const ahead = higher ? consensus > breakeven : consensus < breakeven;
      if (ahead) return `Can ${higher ? 'fall' : 'rise'} ${money(gap)} before you lose.`;
      return `Needs ${money(gap)} to break even.`;
    }
    // A resting order fills at its own price, so there is no walk to average.
    if (push === null) return 'Fills at your price, so no room either way.';
    return `${money(Math.abs(push - breakeven))} of room to be wrong.`;
  })();

  return (
    <div className="pay">
      {top && (
        <div className="pay-cap">
          <span style={captionStyle(top.at)}>
            {top.label} <b>{top.value}</b>
          </span>
        </div>
      )}
      <div className="pay-track-wrap">
        <div className="pay-track">
          <div className={`pay-win pay-win--${direction}`} style={winStyle} />
        </div>
        <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} />
        <div className={`pay-mark pay-mark--be-${direction}`} style={{ left: `${bePct}%` }} />
        {pushPct !== null && <div className="pay-mark pay-mark--push" style={{ left: `${pushPct}%` }} />}
      </div>
      <div className="pay-cap pay-cap--under">
        <span style={captionStyle(bePct)}>
          break even <b>{money(breakeven)}</b>
        </span>
      </div>
      {ends}
      <p className="pay-say">{say}</p>
    </div>
  );
}
