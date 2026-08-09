import { useEffect, useRef, useState } from 'react';
import { previewSell, previewTrade } from '../lib/amm';

/**
 * The trade ticket: the one interactive object on the trading floor.
 * Deliberate two-step interaction (pick a side, then confirm) because the
 * old bar traded instantly on the direction click, which read as an
 * accident. The confirm button always says exactly what it will do
 * ("Place 25 cr on Higher"), the payout appears only once a side is
 * picked (it answers "why press this"), and success flashes on the button
 * itself so the feedback is where the finger is.
 */

export interface TicketPosition { direction: 'higher' | 'lower'; shares: number; totalCost: number }

interface Props {
  probability: number;
  liquidity: number;
  positions: TicketPosition[];
  /** Spendable credits, or null while unknown; rendered inside the ticket
      because the trader's wallet is part of the trade decision, not page
      chrome. */
  balance: number | null;
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
}

const PRESETS = [10, 25, 100, 250];

function fmt(v: number): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function TradeTicket({ probability, liquidity, positions, balance, onTrade, onSell, onPreview, onRequireSignup }: Props) {
  const [dir, setDir] = useState<'higher' | 'lower' | null>(null);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountNum = Math.max(0, Math.floor(parseFloat(amount) || 0));
  const composed = dir && amountNum > 0 ? previewTrade(probability, liquidity, dir, amountNum) : null;
  const payout = composed?.shares ?? null;

  useEffect(() => {
    onPreview?.(composed && dir ? { direction: dir, newProb: composed.newProb } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, amountNum, probability, liquidity]);
  // Clear the ghost when the ticket unmounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview?.(null), []);

  const place = async () => {
    if (!dir || amountNum <= 0 || busy) return;
    if (onRequireSignup) {
      onRequireSignup();
      return;
    }
    setError('');
    setBusy('place');
    try {
      await onTrade(dir, amountNum);
      setPlaced(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setPlaced(false), 1600);
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

  const pick = (d: 'higher' | 'lower') => {
    setDir(cur => (cur === d ? null : d));
    setError('');
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
                  worth {fmt(worth)} cr{' '}
                  <span className={`ticket-pos-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
                    {delta >= 0 ? '+' : '-'}{fmt(Math.abs(delta))}
                  </span>
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

      <div className="ticket-seg" role="group" aria-label="Direction">
        <button
          className={`ticket-side ticket-side--lower${dir === 'lower' ? ' is-active' : ''}`}
          aria-pressed={dir === 'lower'}
          onClick={() => pick('lower')}
        >
          ▼ Lower
        </button>
        <button
          className={`ticket-side ticket-side--higher${dir === 'higher' ? ' is-active' : ''}`}
          aria-pressed={dir === 'higher'}
          onClick={() => pick('higher')}
        >
          ▲ Higher
        </button>
      </div>

      <div className="ticket-amount-row">
        <div className="ticket-amount">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="Credits to spend"
          />
          <span className="ticket-cr">cr</span>
        </div>
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

      <button
        className={`ticket-go${placed ? ' is-placed' : ''}`}
        disabled={!dir || amountNum <= 0 || busy !== null}
        onClick={() => void place()}
      >
        {busy === 'place'
          ? 'Placing…'
          : placed
            ? '✓ Placed'
            : !dir
              ? 'Pick a side'
              : onRequireSignup
                ? 'Sign up to bet'
                : `Place ${amountNum} cr on ${dir === 'higher' ? 'Higher' : 'Lower'}`}
      </button>

      {payout !== null && !placed && (
        <p className="ticket-pays">Pays up to {fmt(payout)} cr if you're right.</p>
      )}
      {error && <p className="ticket-err">{error}</p>}
      {balance !== null && (
        <p className="ticket-balance">
          {balance.toLocaleString('en-US', { maximumFractionDigits: 0 })} cr available
        </p>
      )}
    </div>
  );
}
