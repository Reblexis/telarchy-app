import { previewSell } from '../lib/amm';

/**
 * A held position in the four numbers that matter (docs/ui-conventions.md,
 * "what your position is worth"): what it pays at most, what it is worth
 * right now, what it cost, and the difference. One click opens the manage
 * dialog, which keeps the sell slider.
 */
export interface HeldPosition {
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

function fmt(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

export function PositionSummary({
  positions,
  orders,
  probability,
  liquidity,
  onManage,
}: {
  positions: HeldPosition[];
  orders: number;
  probability: number;
  liquidity: number;
  onManage: () => void;
}) {
  return (
    <button className="pubws-pos-summary" onClick={onManage}>
      {positions.map(p => {
        // Worth now: what selling the whole position would fetch at the
        // market's current call, the honest analogue of an expected value.
        const worth = previewSell(probability, liquidity, p.direction, p.shares);
        const profit = worth - p.totalCost;
        const pct = p.totalCost > 0 ? (profit / p.totalCost) * 100 : 0;
        return (
          <span key={p.direction} className="pubws-pos">
            <span className={`pubws-pos-dir pubws-pos-dir--${p.direction}`}>
              {p.direction === 'higher' ? '▲' : '▼'} {p.direction}
            </span>
            <span
              title={`Pays ${fmt(p.shares)} cr if the number lands at the ${p.direction === 'higher' ? 'top' : 'bottom'} of the range, less in between`}
            >
              pays up to {fmt(p.shares)} cr
            </span>
            <span title="What selling the whole position would fetch right now, at the market's current call">
              worth {fmt(worth)} cr
            </span>
            <span title="What the position cost">spent {fmt(p.totalCost)} cr</span>
            <span
              className={`pubws-pos-profit ${profit >= 0 ? 'is-up' : 'is-down'}`}
              title="Worth now minus what it cost"
            >
              {profit >= 0 ? '+' : '-'}
              {fmt(Math.abs(profit))} ({pct >= 0 ? '+' : ''}
              {pct.toFixed(0)}%)
            </span>
          </span>
        );
      })}
      {orders > 0 && (
        <span className="pubws-pos">
          {orders} resting order{orders > 1 ? 's' : ''}
        </span>
      )}
      <span className="pubws-pos-manage">→ manage</span>
    </button>
  );
}
