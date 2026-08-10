import { useEffect, useRef, useState } from 'react';
import { previewSell, previewTrade } from '../lib/amm';
import type { LimitOrder } from '../lib/api';

/**
 * The trade ticket: the one interactive object on the trading floor.
 *
 * It is NOT a panel (owner decision 2026-08-09: blend it into the page).
 * The rest of the poster is type floating on the background, so a bordered
 * card here read as app furniture bolted onto a printed page. Everything is
 * type now, and exactly one element carries a fill: the confirm, which is
 * therefore unmistakably the action.
 *
 * The ticket asks its questions one at a time (owner direction 2026-08-10,
 * following Manifold): side first, and nothing else exists until that is
 * answered. Then amount, then price. Price is the optional third question:
 * "at any price" is the default and costs nothing to read, and "at my price"
 * reveals one input and turns the confirm into a full sentence, because an
 * instruction the trader cannot read back is an instruction they did not
 * give. Design: docs/limit-orders.md.
 */

export interface TicketPosition { direction: 'higher' | 'lower'; shares: number; totalCost: number }

interface Props {
  probability: number;
  liquidity: number;
  positions: TicketPosition[];
  onTrade: (direction: 'higher' | 'lower', amount: number) => Promise<void>;
  onSell: (p: TicketPosition) => Promise<void>;
  /** Fires whenever the composed (not yet placed) bet changes: the market
      probability it would move the market to, or null when nothing is
      composed. The page projects it onto the chart. */
  onPreview?: (preview: { direction: 'higher' | 'lower'; newProb: number } | null) => void;
  /** Anonymous demo mode: the whole ticket composes normally (side,
      amount, payout, chart ghost), but the confirm reads "Sign up to bet"
      and fires this instead of trading. The ticket itself is the pitch. */
  onRequireSignup?: () => void;
  /** The market in its own units, so the price question can be asked in
      dollars rather than probability. Without these the ticket hides the
      price mode entirely and behaves exactly as it did before. */
  unit?: string;
  consensus?: number | null;
  rangeMin?: number;
  rangeMax?: number;
  /** The caller's own resting orders on this market. */
  orders?: LimitOrder[];
  onPlaceLimit?: (direction: 'higher' | 'lower', limitValue: number, budgetCredits: number) => Promise<void>;
  onCancelLimit?: (id: string) => Promise<void>;
}

// Three, not four: min / mid / the position cap. Every extra preset is
// another number on a page that is trying to have very few.
const PRESETS = [10, 50, 250];

function fmt(v: number): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Metric-space values, formatted the way the headline formats them. */
function fmtValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function TradeTicket({
  probability, liquidity, positions, onTrade, onSell, onPreview, onRequireSignup,
  unit = '', consensus = null, rangeMin, rangeMax, orders = [], onPlaceLimit, onCancelLimit,
}: Props) {
  const [dir, setDir] = useState<'higher' | 'lower' | null>(null);
  const [amount, setAmount] = useState('25');
  const [atMyPrice, setAtMyPrice] = useState(false);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountNum = Math.max(0, Math.floor(parseFloat(amount) || 0));
  const limitNum = limit.trim() === '' ? null : parseFloat(limit.replace(/,/g, ''));
  const canLimit = !!onPlaceLimit && consensus !== null && rangeMin !== undefined && rangeMax !== undefined;
  const composed = dir && amountNum > 0 ? previewTrade(probability, liquidity, dir, amountNum) : null;
  const payout = composed?.shares ?? null;

  // A resting order is only resting if the market has not already reached it.
  // Buying higher means waiting for a cheaper price, so the limit sits below
  // the current call; buying lower waits for a dearer one, so it sits above.
  const limitError = (() => {
    if (!atMyPrice || limitNum === null || consensus === null) return null;
    if (!Number.isFinite(limitNum)) return 'Enter a number';
    if (rangeMin !== undefined && rangeMax !== undefined && (limitNum <= rangeMin || limitNum >= rangeMax)) {
      return `Between ${unit}${fmtValue(rangeMin)} and ${unit}${fmtValue(rangeMax)}`;
    }
    if (dir === 'higher' && limitNum >= consensus) return `Below ${unit}${fmtValue(consensus)}, or it fills right now`;
    if (dir === 'lower' && limitNum <= consensus) return `Above ${unit}${fmtValue(consensus)}, or it fills right now`;
    return null;
  })();

  const limitReady = atMyPrice && limitNum !== null && Number.isFinite(limitNum) && !limitError;

  useEffect(() => {
    // A resting order does not move the price today, so it casts no ghost.
    const show = composed && dir && !atMyPrice;
    onPreview?.(show ? { direction: dir, newProb: composed.newProb } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, amountNum, probability, liquidity, atMyPrice]);
  // Clear the ghost when the ticket unmounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview?.(null), []);

  const flash = () => {
    setPlaced(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setPlaced(false), 1600);
  };

  const place = async () => {
    if (!dir || amountNum <= 0 || busy) return;
    if (atMyPrice && !limitReady) return;
    if (onRequireSignup) {
      onRequireSignup();
      return;
    }
    setError('');
    setBusy('place');
    try {
      if (atMyPrice && onPlaceLimit && limitNum !== null) {
        await onPlaceLimit(dir, limitNum, amountNum);
        setLimit('');
        setAtMyPrice(false);
      } else {
        await onTrade(dir, amountNum);
      }
      flash();
    } catch (e) {
      setError((e as Error).message || 'Trade failed');
    } finally {
      setBusy(null);
    }
  };

  const sell = async (p: TicketPosition) => {
    if (busy) return;
    setError('');
    setBusy(`sell-${p.direction}`);
    try {
      await onSell(p);
    } catch (e) {
      setError((e as Error).message || 'Sell failed');
    } finally {
      setBusy(null);
    }
  };

  const cancelOrder = async (id: string) => {
    if (busy || !onCancelLimit) return;
    setError('');
    setBusy(`cancel-${id}`);
    try {
      await onCancelLimit(id);
    } catch (e) {
      setError((e as Error).message || 'Cancel failed');
    } finally {
      setBusy(null);
    }
  };

  const pick = (d: 'higher' | 'lower') => {
    setDir(cur => (cur === d ? null : d));
    setError('');
    setLimit('');
  };

  const confirmLabel = () => {
    if (busy === 'place') return atMyPrice ? 'Placing order…' : 'Placing…';
    if (placed) return atMyPrice ? '✓ Order resting' : '✓ Placed';
    if (onRequireSignup) return 'Sign up to bet';
    const side = dir === 'higher' ? 'Higher' : 'Lower';
    if (!atMyPrice) return `Place ${amountNum} cr on ${side}`;
    if (limitNum === null || limitError) return `Set a price for ${side}`;
    // The whole instruction, in one readable sentence.
    return `Buy ${side} with ${amountNum} cr ${dir === 'higher' ? 'under' : 'over'} ${unit}${fmtValue(limitNum)}`;
  };

  return (
    <div className="ticket" aria-label="Place a trade">
      {positions.length > 0 && (
        <div className="ticket-pos">
          {positions.map(p => {
            // Live worth: what the position would fetch right now vs what
            // it cost. This moving number is the reason to come back.
            const worth = previewSell(probability, liquidity, p.direction, p.shares);
            const delta = worth - p.totalCost;
            return (
              <div key={p.direction} className="ticket-pos-row">
                <span className={`ticket-pos-dir ticket-pos-dir--${p.direction}`}>
                  {p.direction === 'higher' ? '▲' : '▼'} {p.direction}
                </span>
                <span className="ticket-pos-detail">
                  worth {fmt(worth)} cr
                  {/* The delta is only worth a number once it has moved. */}
                  {Math.abs(delta) >= 0.5 && (
                    <>
                      {' '}
                      <span className={`ticket-pos-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
                        {delta >= 0 ? '+' : '-'}{fmt(Math.abs(delta))}
                      </span>
                    </>
                  )}
                </span>
                <button
                  className="ticket-sell"
                  disabled={busy !== null}
                  onClick={() => void sell(p)}
                >
                  {busy === `sell-${p.direction}` ? 'Selling…' : 'Sell'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Resting orders read in the same register as a held position: what
          you told the market to do while you were away. */}
      {orders.length > 0 && (
        <div className="ticket-pos">
          {orders.map(o => (
            <div key={o.id} className="ticket-pos-row">
              <span className={`ticket-pos-dir ticket-pos-dir--${o.direction}`}>
                {o.direction === 'higher' ? '▲' : '▼'} {o.direction}
              </span>
              <span className="ticket-pos-detail">
                {o.direction === 'higher' ? 'under' : 'over'} {unit}{fmtValue(o.limitValue)}
                {' · '}{fmt(o.remainingCredits)} cr waiting
              </span>
              <button
                className="ticket-sell"
                disabled={busy !== null}
                onClick={() => void cancelOrder(o.id)}
              >
                {busy === `cancel-${o.id}` ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ticket-seg" role="group" aria-label="Direction">
        <button
          className={`ticket-side ticket-side--lower${dir === 'lower' ? ' is-active' : ''}`}
          aria-pressed={dir === 'lower'}
          onClick={() => pick('lower')}
        >
          <span className="ticket-arrow" aria-hidden="true">▼</span> Lower
        </button>
        <button
          className={`ticket-side ticket-side--higher${dir === 'higher' ? ' is-active' : ''}`}
          aria-pressed={dir === 'higher'}
          onClick={() => pick('higher')}
        >
          <span className="ticket-arrow" aria-hidden="true">▲</span> Higher
        </button>
      </div>

      {/* Nothing but the side until a side is chosen (owner direction,
          2026-08-10, following Manifold): an untouched ticket asks one
          question, and the amount, the confirm and the price mode only
          exist once that question is answered. */}
      {dir && (
      <>
      <div className="ticket-amount-row">
        <label className="ticket-amount">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="Credits to spend"
          />
          <span className="ticket-cr">cr</span>
        </label>
        <div className="ticket-chips">
          {PRESETS.map(v => (
            <button
              key={v}
              className={`ticket-chip${amountNum === v ? ' is-active' : ''}`}
              onClick={() => setAmount(String(v))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {canLimit && (
        <div className="ticket-price">
          <div className="ticket-mode" role="group" aria-label="Price">
            <button
              className={`ticket-mode-opt${!atMyPrice ? ' is-active' : ''}`}
              aria-pressed={!atMyPrice}
              onClick={() => { setAtMyPrice(false); setError(''); }}
            >
              at any price
            </button>
            <button
              className={`ticket-mode-opt${atMyPrice ? ' is-active' : ''}`}
              aria-pressed={atMyPrice}
              onClick={() => {
                setAtMyPrice(true);
                setError('');
                // Prefill just inside the current call, on the side that
                // rests, so the field opens with a legal answer rather than
                // an error the trader has to clear first.
                if (!limit && consensus !== null) {
                  const step = Math.max((rangeMax! - rangeMin!) * 0.02, 1);
                  const seed = dir === 'higher' ? consensus - step : consensus + step;
                  setLimit(String(Math.round(Math.min(rangeMax! - 1, Math.max(rangeMin! + 1, seed)))));
                }
              }}
            >
              at my price
            </button>
          </div>

          {atMyPrice && (
            <>
              <label className="ticket-limit">
                <span className="ticket-limit-word">
                  {dir === 'higher' ? 'buy under' : 'buy over'}
                </span>
                <span className="ticket-limit-unit">{unit}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limit}
                  onChange={e => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                  aria-label={`Limit price in ${unit || 'metric units'}`}
                />
              </label>
              <p className="ticket-hint">
                {limitError
                  ? limitError
                  : `${amountNum} cr waits here until the market reaches it.`}
              </p>
            </>
          )}
        </div>
      )}

      <button
        className={`ticket-go${placed ? ' is-placed' : ''}`}
        disabled={amountNum <= 0 || busy !== null || (atMyPrice && !limitReady && !onRequireSignup)}
        onClick={() => void place()}
      >
        {confirmLabel()}
      </button>

      {/* What the bet pays, and nothing else: the wallet belongs in the
          account menu, not under every bet. A resting order has no payout
          yet, so it says nothing rather than guessing. */}
      {payout !== null && !placed && !atMyPrice && (
        <p className="ticket-foot">pays up to {fmt(payout)} cr</p>
      )}
      </>
      )}
      {error && <p className="ticket-err">{error}</p>}
    </div>
  );
}
