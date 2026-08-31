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
  /** Captions are centred on their mark, so the ends need pulling in or the
      caption hangs off the card. */
  const anchor = (p: number) => Math.min(84, Math.max(16, p));
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
        <div className="pay-cap pay-cap--slim">
          <span style={{ left: `${anchor(nowPct)}%` }}>now</span>
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
          <span className="pay-side pay-side--lower">Lower wins under {money(consensus)}</span>
          <span className="pay-side pay-side--higher">Higher wins over {money(consensus)}</span>
        </div>
      </div>
    );
  }

  const bePct = pct(breakeven);
  const pushPct = push === null ? null : pct(push);
  const higher = direction === 'higher';
  const winStyle = higher ? { left: `${bePct}%`, right: '0%' } : { left: '0%', right: `${100 - bePct}%` };

  const topCaption =
    mode === 'hold'
      ? { at: nowPct, text: 'market now ', value: money(consensus) }
      : pushPct !== null && push !== null
        ? { at: pushPct, text: 'you push it to ', value: money(push) }
        : null;

  const say = (() => {
    if (mode === 'hold') {
      const gap = Math.abs(consensus - breakeven);
      const ahead = higher ? consensus > breakeven : consensus < breakeven;
      if (ahead) return `It can ${higher ? 'fall' : 'rise'} ${money(gap)} to ${money(breakeven)} before you lose.`;
      return `It has to ${higher ? 'rise' : 'fall'} ${money(gap)} to ${money(breakeven)} before you win.`;
    }
    // A resting order fills at its own price, so there is no walk to average
    // and no room to be wrong: the limit IS the break-even.
    if (push === null) return `Filled at ${money(breakeven)}, that is exactly where the bet starts paying.`;
    const gap = Math.abs(push - breakeven);
    return `You ${higher ? 'push it to' : 'push it down to'} ${money(push)} but you break even at ${money(
      breakeven,
    )}, so you have ${money(gap)} of room to be wrong.`;
  })();

  return (
    <div className="pay">
      <div className="pay-cap">
        {topCaption && (
          <span style={{ left: `${anchor(topCaption.at)}%` }}>
            {topCaption.text}
            <b>{topCaption.value}</b>
          </span>
        )}
      </div>
      <div className="pay-track-wrap">
        <div className="pay-track">
          <div className={`pay-win pay-win--${direction}`} style={winStyle} />
        </div>
        <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} />
        <div className={`pay-mark pay-mark--be-${direction}`} style={{ left: `${bePct}%` }} />
        {pushPct !== null && <div className="pay-mark pay-mark--push" style={{ left: `${pushPct}%` }} />}
      </div>
      <div className="pay-cap pay-cap--under">
        <span style={{ left: `${anchor(bePct)}%` }}>
          {mode === 'hold' ? 'your break-even ' : 'break even at '}
          <b>{money(breakeven)}</b>
        </span>
      </div>
      {ends}
      <p className="pay-say">{say}</p>
    </div>
  );
}
