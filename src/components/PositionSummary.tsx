import { previewSell } from '../lib/amm';

/**
 * A held position as a card (docs/ui-conventions.md, "what your position is
 * worth"): label over number, four cells, and Sell. Pays up to = one credit
 * per share if the number lands at the range's edge the position bets on;
 * worth now = what selling the whole position would fetch at the market's
 * current call; spent = what it cost; profit = the difference.
 */
export interface HeldPosition {
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

/** "30 Sep", the way the floor names a date. */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
  closed = null,
}: {
  positions: HeldPosition[];
  orders: number;
  probability: number;
  liquidity: number;
  onManage: () => void;
  /** Set once the proposal this position sits on is closed (docs/guides/
   *  proposals.md, "The deadline, and the close"): nothing sells, so the
   *  card says when it settles instead of offering to. */
  closed?: { settlesOn: string | null } | null;
}) {
  return (
    <div className="pubws-poscard" aria-label="Your position">
      {positions.map(p => {
        const worth = previewSell(probability, liquidity, p.direction, p.shares);
        const profit = worth - p.totalCost;
        const pct = p.totalCost > 0 ? (profit / p.totalCost) * 100 : 0;
        return (
          <div key={p.direction} className="pubws-poscard-row">
            <div className="pubws-poscard-cell">
              <span className="pubws-poscard-k">Your position</span>
              <span className={`pubws-poscard-v pubws-poscard-v--${p.direction}`}>
                {p.direction === 'higher' ? '▲' : '▼'} {p.direction} · {fmt(p.shares)} sh
              </span>
            </div>
            <div
              className="pubws-poscard-cell"
              title={`One credit per share if the number lands at the ${p.direction === 'higher' ? 'top' : 'bottom'} of the range, less in between`}
            >
              <span className="pubws-poscard-k">Pays up to</span>
              <span className="pubws-poscard-v">{fmt(p.shares)} cr</span>
            </div>
            <div
              className="pubws-poscard-cell"
              title="What selling the whole position would fetch right now, at the market's current call"
            >
              <span className="pubws-poscard-k">Worth now</span>
              <span className="pubws-poscard-v">{fmt(worth)} cr</span>
            </div>
            <div className="pubws-poscard-cell" title="What the position cost">
              <span className="pubws-poscard-k">Spent</span>
              <span className="pubws-poscard-v">{fmt(p.totalCost)} cr</span>
            </div>
            <div className="pubws-poscard-cell" title="Worth now minus what it cost">
              <span className="pubws-poscard-k">Profit</span>
              <span className={`pubws-poscard-v ${profit >= 0 ? 'is-up' : 'is-down'}`}>
                {profit >= 0 ? '+' : '-'}
                {fmt(Math.abs(profit))}{' '}
                <span className="pubws-poscard-pct">
                  {pct >= 0 ? '+' : ''}
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
          </div>
        );
      })}
      {closed ? (
        <span className="pubws-poscard-settles">
          settles{closed.settlesOn ? ` ${dayOf(closed.settlesOn)}` : ' at the date'}
        </span>
      ) : (
        <div className="pubws-poscard-side">
          {orders > 0 && (
            <span className="pubws-poscard-orders">
              {orders} resting order{orders > 1 ? 's' : ''}
            </span>
          )}
          <button className="pubws-poscard-btn" onClick={onManage}>
            {positions.length > 0 ? 'Sell' : 'Manage'}
          </button>
        </div>
      )}
    </div>
  );
}
