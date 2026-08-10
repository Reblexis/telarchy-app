import { useEffect, useRef, useState } from 'react';
import { previewSell, previewTrade } from '../lib/amm';
import type { LimitOrder } from '../lib/api';

/**
 * The trade ticket, in Manifold's layout (owner direction 2026-08-10): a
 * card with the two sides as pills top left and a Quick / Limit toggle top
 * right. The amount is one bare underlined numeral with a slider in the
 * side's colour under it (owner direction, same day: no boxed field, no
 * stepper chips), then the answer rows, then one full-width confirm tinted
 * by the chosen side.
 *
 * The win is stated as breakeven + slope, never as the at-the-range-edge
 * maximum: a share's payout is linear in the settled value, so "to win X"
 * (X being the payout only if the year ends at the range ceiling) reads as
 * a riddle. "Wins above $74,300 / each $10k beyond +3.1 cr" is the same
 * line, said in full.
 *
 * Progressive disclosure survives the redesign: an untouched ticket shows
 * only the two side pills, and the rest of the card exists once a side is
 * picked. Limit mode swaps in a price input and turns the confirm into the
 * whole instruction ("Buy Higher with 25 cr under $65,000"), because an
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

const MAX_BET = 250;

/** A round metric-space step for the "each X beyond" line: ~1/50 of the
    range snapped to 1/2/5, so a $0..500k market speaks in $10k steps. */
function niceStep(span: number): number {
  const raw = span / 50;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const c = [1, 2, 5, 10].find(m => m * mag >= raw) ?? 10;
  return c * mag;
}

function stepLabel(step: number): string {
  return step >= 1000 ? `${step / 1000}k` : String(step);
}

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
  const limitDisplay = limitNum !== null && Number.isFinite(limitNum) && !limit.endsWith('.')
    ? limitNum.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : limit;
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

  // The win, said comprehensibly. A share's payout is linear in the settled
  // value, so "to win X" (the payout at the range's very edge) reads as a
  // riddle. Two numbers define the whole line instead: the settled value at
  // which the bet breaks even, and what each further round step pays.
  const step = span !== null ? niceStep(span) : null;
  const winFacts = (() => {
    if (!dir || span === null || rangeMin === undefined || step === null) return null;
    if (isLimit) {
      // A fill happens at the limit itself, so the limit IS the breakeven,
      // which is the whole appeal of naming your price.
      if (!limitReady || limitNum === null) return null;
      const p = (limitNum - rangeMin) / span;
      const price = dir === 'higher' ? p : 1 - p;
      if (price <= 0.001) return null;
      const shares = amountNum / price;
      return { breakeven: limitNum, slope: (shares * step) / span };
    }
    if (!composed || composed.shares <= 0 || amountNum <= 0) return null;
    const avg = amountNum / composed.shares;
    const breakeven = dir === 'higher' ? rangeMin + avg * span : rangeMin + (1 - avg) * span;
    return { breakeven, slope: (composed.shares * step) / span };
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
    return `Bet ${amountNum} cr on ${sideWord}`;
  };

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
      {/* The amount is one number, typed or slid, and nothing else: no box,
          no stepper chips. The underline is the input; the slider under it
          is the same value in the side's colour. */}
      <label className="ticket-amt">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={amount}
          style={{ width: `${Math.max(1, amount.length)}ch` }}
          onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          aria-label="Credits to spend"
        />
        <span className="ticket-amt-unit">cr</span>
      </label>
      <input
        className={`ticket-slider ticket-slider--${dir}`}
        type="range"
        min={1}
        max={MAX_BET}
        value={Math.min(MAX_BET, Math.max(1, amountNum))}
        style={(() => {
          // The thumb's center travels [7px, width-7px], not [0, width], so
          // the fill must land under the thumb, not merely at value%.
          const p = ((Math.min(MAX_BET, Math.max(1, amountNum)) - 1) / (MAX_BET - 1)) * 100;
          return { ['--slider-pct' as string]: `calc(${p.toFixed(2)}% + ${((0.5 - p / 100) * 14).toFixed(1)}px)` };
        })()}
        onChange={e => setAmount(e.target.value)}
        aria-label="Bet amount slider"
      />

      {isLimit && (
        <>
          <p className="ticket-label">
            {dir === 'higher' ? 'buy when the market is under' : 'buy when the market is over'}
          </p>
          <label className="ticket-amt ticket-amt--price">
            <span className="ticket-amt-unit">{unit || '#'}</span>
            {/* Shown with thousands separators ("63,600" reads as a price,
                "63600" reads as a serial number); the state stays raw. */}
            <input
              type="text"
              inputMode="decimal"
              value={limitDisplay}
              style={{ width: `${Math.max(1, limitDisplay.length)}ch` }}
              onChange={e => setLimit(e.target.value.replace(/[^0-9.]/g, ''))}
              aria-label={`Limit price in ${unit || 'metric units'}`}
            />
          </label>
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
        {winFacts && step !== null && (
          <>
            <div className="ticket-fact">
              <span className="ticket-fact-k">{isLimit ? 'Once filled, wins' : 'Wins'} {dir === 'higher' ? 'above' : 'below'}</span>
              <span className="ticket-fact-v">{unit}{fmtValue(winFacts.breakeven)}</span>
            </div>
            <div className="ticket-fact">
              <span className="ticket-fact-k">Each {unit}{stepLabel(step)} beyond</span>
              <span className="ticket-fact-v"><span className="ticket-fact-d is-up">+{fmt(winFacts.slope)} cr</span></span>
            </div>
          </>
        )}
        {isLimit && !limitError && (
          <div className="ticket-fact">
            <span className="ticket-fact-k">Until filled</span>
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
