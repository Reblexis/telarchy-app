import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { previewSell } from '../lib/amm';
import { rangeLine, stakePreview } from '../lib/market-quote';
import { authPath } from '../lib/nextPath';
import { MarketFacts } from './MarketFacts';
import { OAuthButtons } from './OAuthButtons';

/**
 * The verbs panel (docs/ui-conventions.md, "The verbs and the inline
 * ticket"): one panel under the settlement line, three rows, the same for a
 * signed-in trader and a stranger. The stake and this book's facts, the two
 * verbs each quoting what the stake in the field pays, and the range line
 * that is the rule those two previews follow. A verb press opens the ticket
 * inline underneath, or, for a stranger, the sign-up door in its place.
 */

/** The stake presets under the field. */
export const STAKE_PRESETS = [10, 25, 100, 500];
/** Where the stake a trader last used is remembered, per session. */
export const STAKE_KEY = 'telarchy-stake';
/** The bet a stranger composed, kept across the sign-up door. */
export const BET_INTENT_KEY = 'telarchy-bet-intent';

const cr = (n: number) => Math.round(n).toLocaleString('en-US');

export interface BetIntent {
  floor: string;
  marketId: string;
  direction: 'higher' | 'lower';
  stake: number;
}

export function FloorVerbs({
  unit,
  rangeMin,
  rangeMax,
  probability,
  liquidity,
  funded,
  traders,
  pool,
  lastTradeAt,
  now,
  stake,
  stakeText,
  onStake,
  signedIn,
  onVerb,
  onInject,
  children,
}: {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  probability: number;
  liquidity: number;
  /** Whether this book has liquidity of its own. An unfunded book never
   *  shows bet buttons, whatever number is drawn above it. */
  funded: boolean;
  traders: number;
  pool: number;
  lastTradeAt: string | null;
  now: Date;
  /** The stake the previews are quoted at, as a number. */
  stake: number;
  /** The same stake as typed, so an emptied field stays empty. */
  stakeText: string;
  onStake: (next: string) => void;
  signedIn: boolean;
  onVerb: (direction: 'higher' | 'lower') => void;
  /** Deepening the book, for anyone signed in; null when nobody here can. */
  onInject: (() => void) | null;
  /** The inline ticket, or the sign-up door in its place. */
  children?: ReactNode;
}) {
  const quote = (direction: 'higher' | 'lower') =>
    stakePreview(unit, rangeMin, rangeMax, probability, liquidity, direction, stake);
  return (
    <section className="pubws-verbs" aria-label="Place a bet">
      <div className="pubws-verbs-stake">
        <label className="pubws-stake">
          <span className="pubws-stake-k">Stake</span>
          <input
            className="pubws-stake-fld"
            inputMode="numeric"
            value={stakeText}
            aria-label="Stake"
            onChange={e => onStake(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <span className="pubws-stake-u">cr</span>
        </label>
        <span className="pubws-stake-chips">
          {STAKE_PRESETS.map(n => (
            <button key={n} type="button" className="pubws-stake-chip" onClick={() => onStake(String(n))}>
              {n}
            </button>
          ))}
        </span>
        <MarketFacts traders={traders} pool={pool} lastTradeAt={lastTradeAt} now={now} />
      </div>
      {funded ? (
        <>
          <div className="pubws-verbs-row" role="group" aria-label="Bet">
            {(['higher', 'lower'] as const).map(direction => {
              const q = quote(direction);
              return (
                <button
                  key={direction}
                  type="button"
                  className={`pubws-verb pubws-verb--${direction}`}
                  onClick={() => onVerb(direction)}
                >
                  <span className="pubws-verb-word">{direction === 'higher' ? 'Bet Higher ↑' : 'Bet Lower ↓'}</span>
                  {q && <span className="pubws-verb-preview">{q.line}</span>}
                </button>
              );
            })}
          </div>
          <p className="pubws-range-line">{rangeLine(unit, rangeMin, rangeMax)}</p>
          {!signedIn && <p className="pubws-verbs-signup">Sign up to trade · free credits to start</p>}
        </>
      ) : (
        <p className="pubws-unfunded" role="status">
          Nobody has funded a book for this market yet, so there is nothing to trade against.
          {onInject && (
            <button type="button" className="pubws-unfunded-go" onClick={onInject}>
              Inject liquidity
            </button>
          )}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * The sign-up door, inside the verbs panel and in the ticket's place: the
 * verb and stake the stranger chose echoed above the form, so signing up
 * reads as placing that bet rather than as an interruption. The intent is
 * kept for after the door, and the page opens the ticket on it.
 */
export function SignupDoor({
  direction,
  unit,
  rangeMin,
  rangeMax,
  probability,
  liquidity,
  stake,
  onContinue,
}: {
  direction: 'higher' | 'lower';
  unit: string;
  rangeMin: number;
  rangeMax: number;
  probability: number;
  liquidity: number;
  stake: number;
  /** Opens the sign-up door, carrying the email the visitor typed. */
  onContinue: (email: string) => void;
}) {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const q = stakePreview(unit, rangeMin, rangeMax, probability, liquidity, direction, stake);
  const word = direction === 'higher' ? 'Higher' : 'Lower';
  return (
    <div className="pubws-signup-door">
      <p className="pubws-signup-door-title">Sign up to place this bet</p>
      {q && <p className="pubws-signup-door-echo">{`Bet ${word} · ${q.echo}`}</p>}
      <OAuthButtons onError={setError} />
      <p className="pubws-signup-door-or">or</p>
      <form
        className="pubws-signup-door-form"
        onSubmit={e => {
          e.preventDefault();
          onContinue(email);
        }}
      >
        <input
          type="email"
          className="pubws-signup-door-email"
          placeholder="you@example.com"
          aria-label="Your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button type="submit" className="pubws-cta pubws-cta--small">
          Continue
        </button>
      </form>
      {error && <p className="ticket-err">{error}</p>}
      <p className="pubws-signup-door-back">
        <span>Already have an account?</span> <Link to={authPath('login', location)}>Log in</Link>
      </p>
    </div>
  );
}

/**
 * Your position (docs/ui-conventions.md, "Your position"): one ruled icon
 * row under the verbs panel. A trader holds ONE net side, so the row is
 * never two rows; the profit is hidden while it is still zero, because a
 * marked zero reads as a loss that has not happened.
 */
export function PositionRow({
  direction,
  shares,
  totalCost,
  probability,
  liquidity,
  onSell,
}: {
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
  probability: number;
  liquidity: number;
  onSell: () => void;
}) {
  const worth = previewSell(probability, liquidity, direction, shares);
  const profit = worth - totalCost;
  const pct = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  return (
    <div className="pubws-position" aria-label="Your position">
      <span className="pubws-position-label">Your position</span>
      <span className={`pubws-position-cell pubws-position-cell--${direction}`}>
        {direction === 'higher' ? '▲' : '▼'} {direction === 'higher' ? 'Higher' : 'Lower'} · {cr(shares)} sh
      </span>
      <span
        className="pubws-position-cell"
        title={`One credit per share if the number lands at the ${
          direction === 'higher' ? 'top' : 'bottom'
        } of the range, less in between`}
      >
        pays up to {cr(shares)} cr
      </span>
      <span className="pubws-position-cell" title="What selling the whole position would fetch right now">
        worth {cr(worth)} cr
      </span>
      <span className="pubws-position-cell" title="Net cash paid, sells counted negative">
        spent {cr(totalCost)} cr
      </span>
      {Math.abs(profit) >= 0.05 && (
        <span className={`pubws-position-cell ${profit >= 0 ? 'is-up' : 'is-down'}`}>
          {profit < 0 ? '-' : '+'}
          {Math.abs(profit).toFixed(1)} cr ({Math.round(pct)}%)
        </span>
      )}
      <button type="button" className="pubws-position-sell" onClick={onSell}>
        Sell
      </button>
    </div>
  );
}
