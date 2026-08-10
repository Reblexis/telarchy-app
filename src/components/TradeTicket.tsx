import { useEffect, useRef, useState } from 'react';
import { previewSell, previewTrade } from '../lib/amm';
import type { LimitOrder } from '../lib/api';

/**
 * The trade ticket, in Manifold's layout (owner direction 2026-08-10, from a
 * screenshot of Manifold's bet panel): a card, the two sides as pills top
 * left, a Quick / Limit toggle top right, a boxed amount with steppers and a
 * slider, then two answer rows ("New value", "To win") and one full-width
 * confirm that names the payout ("Buy HIGHER to win 106 cr").
 *
 * Progressive disclosure survives the redesign: an untouched ticket shows
 * only the two side pills, and the rest of the card exists once a side is
 * picked. Limit mode swaps the answer rows for a price box and turns the
 * confirm into the whole instruction ("Buy Higher with 25 cr under
 * $65,000"), because an instruction the trader cannot read back is an
 * instruction they did not give. Design: docs/limit-orders.md.
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
  /** The market in its own units, so the price rows speak dollars rather
      than probability. Without these the Limit toggle hides and the ticket
      degrades to Quick-only. */
  unit?: string;
  consensus?: number | null;
  rangeMin?: number;
  rangeMax?: number;
  /** The caller's own resting orders on this market. */
  orders?: LimitOrder[];
  onPlaceLimit?: (direction: 'higher' | 'lower', limitValue: number, budgetCredits: number) => Promise<void>;
  onCancelLimit?: (id: string) => Promise<void>;
}

// Steppers, Manifold-style: nudge and leap. The slider covers the rest of
// the range up to the position cap.
const STEPS = [-10, 10, 50];
const MAX_BET = 250;

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
  const [mode, setMode] = useState<'quick' | 'limit'>('quick');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountNum = Math.max(0, Math.floor(parseFloat(amount) || 0));
  const limitNum = limit.trim() === '' ? null : parseFloat(limit.replace(/,/g, ''));
  const canLimit = !!onPlaceLimit && consensus !== null && rangeMin !== undefined && rangeMax !== undefined;
  const isLimit = mode === 'limit' && canLimit;
  const composed = dir && amountNum > 0 ? previewTrade(probability, liquidity, dir, amountNum) : null;
  const payout = composed?.shares ?? null;
  const span = rangeMin !== undefined && rangeMax !== undefined ? rangeMax - rangeMin : null;
  // Where the market's call would land if this bet were placed now.
  const newValue = composed && span !== null && rangeMin !== undefined
    ? rangeMin + composed.newProb * span
    : null;

  // A resting order is only resting if the market has not already reached it.
  // Buying higher means waiting for a cheaper price, so the limit sits below
  // the current call; buying lower waits for a dearer one, so it sits above.
  const limitError = (() => {
    if (!isLimit || limitNum === null || consensus === null) return null;
    if (!Number.isFinite(limitNum)) return 'Enter a number';
    if (rangeMin !== undefined && rangeMax !== undefined && (limitNum <= rangeMin || limitNum >= rangeMax)) {
      return `Between ${unit}${fmtValue(rangeMin)} and ${unit}${fmtValue(rangeMax)}`;
    }
    if (dir === 'higher' && limitNum >= consensus) return `Below ${unit}${fmtValue(consensus)}, or it fills right now`;
    if (dir === 'lower' && limitNum <= consensus) return `Above ${unit}${fmtValue(consensus)}, or it fills right now`;
    return null;
  })();

  const limitReady = isLimit && limitNum !== null && Number.isFinite(limitNum) && !limitError;

  // What a fill at the limit would pay: shares priced at the limit itself,
  // which is exactly where a limit order buys. An estimate, and labelled so.
  const limitPayout = (() => {
    if (!limitReady || span === null || rangeMin === undefined || limitNum === null || !dir) return null;
    const p = (limitNum - rangeMin) / span;
    const price = dir === 'higher' ? p : 1 - p;
    if (price <= 0.001) return null;
    return amountNum / price;
  })();

  useEffect(() => {
    // A resting order does not move the price today, so it casts no ghost.
    const show = composed && dir && !isLimit;
    onPreview?.(show ? { direction: dir, newProb: composed.newProb } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, amountNum, probability, liquidity, isLimit]);
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
    if (isLimit && !limitReady) return;
    if (onRequireSignup) {
      onRequireSignup();
      return;
    }
    setError('');
    setBusy('place');
    try {
      if (isLimit && onPlaceLimit && limitNum !== null) {
        await onPlaceLimit(dir, limitNum, amountNum);
        setLimit('');
        setMode('quick');
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
  };

  const enterLimit = () => {
    setMode('limit');
    setError('');
    // Prefill just inside the current call, on the side that rests, so the
    // field opens with a legal answer rather than an error to clear first.
    if (!limit && consensus !== null && span !== null && rangeMin !== undefined && rangeMax !== undefined) {
      const step = Math.max(span * 0.02, 1);
      const seed = dir === 'higher' ? consensus - step : consensus + step;
      setLimit(String(Math.round(Math.min(rangeMax - 1, Math.max(rangeMin + 1, seed)))));
    }
  };

  const sideWord = dir === 'higher' ? 'Higher' : 'Lower';
  const confirmLabel = () => {
    if (busy === 'place') return isLimit ? 'Placing order…' : 'Placing…';
    if (placed) return isLimit ? '✓ Order resting' : '✓ Placed';
    if (onRequireSignup) return 'Sign up to bet';
    if (isLimit) {
      if (limitNum === null || limitError) return `Set a price for ${sideWord}`;
      // The whole instruction, in one readable sentence.
      return `Buy ${sideWord} with ${amountNum} cr ${dir === 'higher' ? 'under' : 'over'} ${unit}${fmtValue(limitNum)}`;
    }
    return payout !== null
      ? `Buy ${sideWord.toUpperCase()} to win ${fmt(payout)} cr`
      : `Buy ${sideWord.toUpperCase()}`;
  };

  const step = (delta: number) => setAmount(String(Math.max(1, Math.min(MAX_BET, amountNum + delta))));

  return (
    <div className={`ticket${dir ? ' is-open' : ''}`} aria-label="Place a trade">
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

      <div className="ticket-head">
        <div className="ticket-seg" role="group" aria-label="Direction">
          <button
            className={`ticket-side ticket-side--lower${dir === 'lower' ? ' is-active' : ''}`}
            aria-pressed={dir === 'lower'}
            onClick={() => pick('lower')}
          >
            Lower
          </button>
          <button
            className={`ticket-side ticket-side--higher${dir === 'higher' ? ' is-active' : ''}`}
            aria-pressed={dir === 'higher'}
            onClick={() => pick('higher')}
          >
            Higher
          </button>
        </div>

        {/* The price question lives in the header, Manifold-style, but only
            once a side exists to ask it about (owner direction 2026-08-10:
            an untouched ticket asks one question). */}
        {dir && canLimit && (
          <div className="ticket-mode" role="group" aria-label="Order type">
            <button
              className={`ticket-mode-opt${!isLimit ? ' is-active' : ''}`}
              aria-pressed={!isLimit}
              onClick={() => { setMode('quick'); setError(''); }}
            >
              Quick
            </button>
            <button
              className={`ticket-mode-opt${isLimit ? ' is-active' : ''}`}
              aria-pressed={isLimit}
              onClick={enterLimit}
            >
              Limit
            </button>
          </div>
        )}
        {dir && (
          <button className="ticket-close" aria-label="Close" onClick={() => setDir(null)}>×</button>
        )}
      </div>

      {dir && (
      <>
      <p className="ticket-label">Bet amount</p>
      <div className="ticket-amt-box">
        <label className="ticket-amount">
          <span className="ticket-cr">cr</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="Credits to spend"
          />
        </label>
        <div className="ticket-steps">
          {STEPS.map(v => (
            <button key={v} className="ticket-step" onClick={() => step(v)}>
              {v > 0 ? `+${v}` : v}
            </button>
          ))}
        </div>
      </div>
      <input
        className="ticket-slider"
        type="range"
        min={1}
        max={MAX_BET}
        value={Math.min(MAX_BET, Math.max(1, amountNum))}
        onChange={e => setAmount(e.target.value)}
        aria-label="Bet amount slider"
      />

      {isLimit && (
        <>
          <p className="ticket-label">
            {dir === 'higher' ? 'Buy when the market is under' : 'Buy when the market is over'}
          </p>
          <div className="ticket-amt-box">
            <label className="ticket-amount">
              <span className="ticket-cr">{unit || '#'}</span>
              <input
                type="text"
                inputMode="decimal"
                value={limit}
                onChange={e => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label={`Limit price in ${unit || 'metric units'}`}
              />
            </label>
          </div>
          {limitError && <p className="ticket-err">{limitError}</p>}
        </>
      )}

      <div className="ticket-facts">
        {!isLimit && newValue !== null && consensus !== null && (
          <div className="ticket-fact">
            <span className="ticket-fact-k">New value</span>
            <span className="ticket-fact-v">
              {unit}{fmtValue(newValue)}
              <span className={`ticket-fact-d ${newValue >= consensus ? 'is-up' : 'is-down'}`}>
                {' '}{newValue >= consensus ? '↑' : '↓'}{unit}{fmtValue(Math.abs(newValue - consensus))}
              </span>
            </span>
          </div>
        )}
        {!isLimit && payout !== null && (
          <div className="ticket-fact">
            <span className="ticket-fact-k">To win</span>
            <span className="ticket-fact-v">
              {fmt(payout)} cr
              {amountNum > 0 && payout > amountNum && (
                <span className="ticket-fact-d is-up"> +{Math.round(((payout - amountNum) / amountNum) * 100)}%</span>
              )}
            </span>
          </div>
        )}
        {isLimit && limitPayout !== null && (
          <div className="ticket-fact">
            <span className="ticket-fact-k">If filled</span>
            <span className="ticket-fact-v">
              wins up to {fmt(limitPayout)} cr
            </span>
          </div>
        )}
        {isLimit && !limitError && (
          <div className="ticket-fact">
            <span className="ticket-fact-k">Until then</span>
            <span className="ticket-fact-v">{amountNum} cr waits, cancel anytime</span>
          </div>
        )}
      </div>

      <button
        className={`ticket-go${placed ? ' is-placed' : ''} ticket-go--${dir}`}
        disabled={amountNum <= 0 || busy !== null || (isLimit && !limitReady && !onRequireSignup)}
        onClick={() => void place()}
      >
        {confirmLabel()}
      </button>
      </>
      )}
      {error && <p className="ticket-err">{error}</p>}
    </div>
  );
}
