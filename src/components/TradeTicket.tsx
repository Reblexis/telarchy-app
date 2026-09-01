import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEarnAvailable } from '../hooks/useEarnAvailable';
import { previewSell, previewTargetBet, previewTrade } from '../lib/amm';
import type { LimitOrder } from '../lib/api';
import { amountToSlider, SLIDER_STEPS, sliderToAmount } from '../lib/bet-slider';
import { maxWinLabel } from '../lib/market-quote';
import { PayoffLine } from './PayoffLine';

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

export interface TicketPosition {
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

interface Props {
  probability: number;
  liquidity: number;
  positions: TicketPosition[];
  onTrade: (direction: 'higher' | 'lower', amount: number) => Promise<void>;
  /** Place a {targetValue, maxBudget} trade: the server lands exactly on
      the target (budget permitting), netting included, so the value the
      ticket promised is the value the market prints. Used whenever the
      trade was composed by typing into the "New value" row. */
  onTradeTarget?: (targetValue: number, maxBudget: number) => Promise<void>;
  /** Sell `shares` of the held position (defaults to the whole thing). */
  onSell: (p: TicketPosition, shares: number) => Promise<void>;
  /** Credits available to spend, so the bet slider scales to what the
      trader can actually afford instead of a fixed cap. */
  balance?: number | null;
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
  /** Open with a side already chosen (the floor's Lower/Higher buttons
      preselect it when they spawn the ticket in a dialog). */
  initialDir?: 'higher' | 'lower';
  /** In a dialog, the X closes the dialog instead of collapsing the card. */
  onClose?: () => void;
  /** Managing an existing position (selling/cancelling), not opening a new
      bet: hide the Lower/Higher side pills, which are only for a new trade. */
  manageMode?: boolean;
}

/** A round metric-space step for the "each X beyond" line: ~1/50 of the
    range snapped to 1/2/5, so a $0..500k market speaks in $10k steps. */
function niceStep(span: number): number {
  const raw = span / 50;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const c = [1, 2, 5, 10].find(m => m * mag >= raw) ?? 10;
  return c * mag;
}

function stepLabel(step: number): string {
  return step >= 1000 ? `${step / 1000}k` : String(step);
}

/** Shares are fractional; show enough to read a partial sale. */
function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
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
  probability,
  liquidity,
  positions,
  onTrade,
  onTradeTarget,
  onSell,
  balance,
  onPreview,
  onRequireSignup,
  unit = '',
  consensus = null,
  rangeMin,
  rangeMax,
  orders = [],
  onPlaceLimit,
  onCancelLimit,
  initialDir,
  onClose,
  manageMode = false,
}: Props) {
  const [dir, setDir] = useState<'higher' | 'lower' | null>(initialDir ?? null);
  const [amount, setAmount] = useState('25');
  const [mode, setMode] = useState<'quick' | 'limit'>('quick');
  const [limit, setLimit] = useState('');
  // Betting towards a value (owner direction 2026-08-11) without a new
  // field: the "New value" row is editable while focused. Typing a target
  // sets the side and the amount to whatever reaches it (capped at
  // the affordable maxBet); blurring returns the row to the derived display.
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  // The committed target value, when the trade was composed by typing one.
  // While set, the confirm places a {targetValue, maxBudget} trade, which
  // the server lands ON the target; picking a side or editing the amount by
  // hand goes back to a plain budget buy and clears it.
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Selling a specific amount (owner ask 2026-08-11): a row expands into a
  // shares slider instead of only "sell all". Keyed by direction; the draft
  // is the shares count being sold.
  const [sellDir, setSellDir] = useState<'higher' | 'lower' | null>(null);
  const [sellShares, setSellShares] = useState(0);

  // The one position the trader holds (the server keeps them to a single
  // net side). Every buy preview needs it: buying the opposite side hands
  // back 1 credit per matched pair the buy creates.
  const held = positions.find(p => p.shares > 1e-9) ?? null;

  // The bet ceiling is what the trader can afford (owner removed the
  // per-market cap 2026-08-11); fall back to a sane default before the
  // balance loads. The slider maxes here. The balance is the whole ceiling
  // since 2026-08-30: redemption pays out AFTER the buy, so unlike the
  // liquidation it replaced it cannot fund the buy itself. Someone who
  // wants their position's cash first sells it, which is the panel below.
  const maxBet = Math.max(1, Math.floor(balance != null && balance > 0 ? balance : 250));
  const earnAvailable = useEarnAvailable(balance != null);

  const amountNum = Math.max(0, Math.floor(parseFloat(amount) || 0));
  const limitNum = limit.trim() === '' ? null : parseFloat(limit.replace(/,/g, ''));
  const limitDisplay =
    limitNum !== null && Number.isFinite(limitNum) && !limit.endsWith('.')
      ? limitNum.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : limit;
  const canLimit = !!onPlaceLimit && consensus !== null && rangeMin !== undefined && rangeMax !== undefined;
  const isLimit = mode === 'limit' && canLimit;
  const span = rangeMin !== undefined && rangeMax !== undefined ? rangeMax - rangeMin : null;
  // A typed target previews (and places) the server's targetValue mode; a
  // hand-picked side and amount preview a budget buy. Both replay the
  // netting close first, so what this shows is what the trade lands on.
  const targetComposed =
    target !== null && span !== null && rangeMin !== undefined && amountNum > 0
      ? previewTargetBet(probability, liquidity, rangeMin, rangeMin + span, target, amountNum, held)
      : null;
  const composed =
    targetComposed ?? (dir && amountNum > 0 ? previewTrade(probability, liquidity, dir, amountNum, held) : null);
  const _payout = composed?.shares ?? null;
  // Where the market's call would land if this bet were placed now.
  const newValue = composed && span !== null && rangeMin !== undefined ? rangeMin + composed.newProb * span : null;

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
      return { breakeven: limitNum, slope: (shares * step) / span, maxPayout: shares, spend: amountNum };
    }
    if (!composed || composed.shares <= 0 || amountNum <= 0) return null;
    // A typed target spends its computed cost, not the whole budget ceiling.
    const spend = targetComposed ? targetComposed.cost : amountNum;
    if (spend <= 0) return null;
    const avg = spend / composed.shares;
    const breakeven = dir === 'higher' ? rangeMin + avg * span : rangeMin + (1 - avg) * span;
    // The most this bet can pay (one credit per share, if the number lands
    // at the range's own edge) and that as a return on the spend.
    return { breakeven, slope: (composed.shares * step) / span, maxPayout: composed.shares, spend };
  })();

  useEffect(() => {
    // A resting order does not move the price today, so it casts no ghost.
    const show = composed && dir && !isLimit;
    onPreview?.(show ? { direction: dir, newProb: composed.newProb } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, amountNum, probability, liquidity, isLimit, target, held?.direction, held?.shares]);
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
      } else if (target !== null && onTradeTarget) {
        // Composed by typing a value: place the server's targetValue mode,
        // which lands ON the typed value (budget permitting) instead of
        // approximating it with a budget buy.
        await onTradeTarget(target, amountNum);
        setTarget(null);
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

  const sell = async (p: TicketPosition, shares: number) => {
    if (busy) return;
    setError('');
    setBusy(`sell-${p.direction}`);
    try {
      await onSell(p, shares);
      setSellDir(null);
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
    setTarget(null);
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

  /* The payoff line answers what the four fact rows used to (owner,
     2026-08-31: "also remove the up to and each $20 beyond"), so they are
     drawn only where it cannot be: a market with no range. */
  const hasPayoff = rangeMin !== undefined && rangeMax !== undefined && consensus !== null;
  /* What each side has on the table, which is what the pills quote. */
  const higherCeiling = maxWinLabel(probability, liquidity);
  const lowerCeiling = maxWinLabel(1 - probability, liquidity);
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
    if (target !== null) {
      // A typed target is an instruction about the landing value, and the
      // budget is a ceiling rather than the spend, so say it that way.
      return `Bet to ${unit}${fmtValue(target)}, up to ${amountNum} cr`;
    }
    return `Bet ${amountNum} cr on ${sideWord}`;
  };

  /* The pushed-to value is an input: focus it, type a target, and the
     ticket sets the side and the cost that reach it. It lives on the
     payoff line now (the fact row that used to hold it is gone), and
     falls back to that row on a market with no range to draw. */
  const targetInput =
    newValue === null || span === null || rangeMin === undefined ? null : (
      <input
        className="ticket-newvalue"
        value={targetDraft ?? fmtValue(newValue)}
        style={{ width: `${Math.max(2, (targetDraft ?? fmtValue(newValue)).length)}ch` }}
        onFocus={e => {
          setTargetDraft(fmtValue(newValue).replace(/,/g, ''));
          // A plain select() dies when the mouse click that caused
          // the focus lands and collapses the selection to a caret,
          // so a real mouse user TYPES INTO the old number (caught
          // by the 2026-08-11 VM smoke: "74100" became
          // "7674100840"). Selecting on the next frame outlives
          // the click.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onBlur={() => setTargetDraft(null)}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setTargetDraft(raw);
          const t = parseFloat(raw);
          if (!Number.isFinite(t)) return;
          const clamped = Math.min(rangeMin + span * 0.999, Math.max(rangeMin + span * 0.001, t));
          // Full server mirror (netting close included): the side
          // shown and the cost charged are the ones the server will
          // actually use, and place() sends the target itself.
          const r = previewTargetBet(
            probability,
            liquidity,
            rangeMin,
            rangeMin + span,
            clamped,
            Number.MAX_SAFE_INTEGER,
            held,
          );
          if (!r) return;
          setDir(r.direction);
          setAmount(String(Math.min(maxBet, Math.max(1, Math.ceil(r.cost)))));
          setTarget(clamped);
        }}
        inputMode="decimal"
        aria-label={`Bet the market to this value in ${unit || 'metric units'}`}
        title="Type a value to bet the market there"
      />
    );

  return (
    <div className={`ticket${dir ? ' is-open' : ''}`} aria-label="Place a trade">
      {/* The held-position rows (with their Sell affordance) belong to
        manage mode only (owner ask 2026-08-28: selling is the panel below
        the ticket, not the bet ticket). The positions PROP still arrives in
        both modes, because the preview nets against it. */}
      {manageMode && held !== null && rangeMin !== undefined && rangeMax !== undefined && consensus !== null && (
        <PayoffLine
          unit={unit}
          rangeMin={rangeMin}
          rangeMax={rangeMax}
          consensus={consensus}
          direction={held.direction}
          breakeven={
            held.direction === 'higher'
              ? rangeMin + (held.totalCost / held.shares) * (rangeMax - rangeMin)
              : rangeMin + (1 - held.totalCost / held.shares) * (rangeMax - rangeMin)
          }
          shares={held.shares}
          spend={held.totalCost}
        />
      )}

      {manageMode && positions.length > 0 && (
        <div className="ticket-pos">
          {positions.map(p => {
            // Live worth: what the position would fetch right now vs what
            // it cost. This moving number is the reason to come back.
            const worth = previewSell(probability, liquidity, p.direction, p.shares);
            const delta = worth - p.totalCost;
            const selling = sellDir === p.direction;
            // How many shares the slider is selling, and what they fetch.
            const sharesToSell = Math.min(p.shares, Math.max(0, sellShares));
            const sellWorth = previewSell(probability, liquidity, p.direction, sharesToSell);
            const sellPct = p.shares > 0 ? (sharesToSell / p.shares) * 100 : 0;
            return (
              <div key={p.direction} className={`ticket-pos-row${selling ? ' is-selling' : ''}`}>
                <div className="ticket-pos-head">
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
                          {delta >= 0 ? '+' : '-'}
                          {fmt(Math.abs(delta))}
                        </span>
                      </>
                    )}
                  </span>
                  <button
                    className="ticket-sell"
                    disabled={busy !== null}
                    onClick={() => {
                      if (selling) {
                        setSellDir(null);
                        return;
                      }
                      setSellDir(p.direction);
                      setSellShares(p.shares); // default to the whole thing
                    }}
                  >
                    {selling ? 'Cancel' : 'Sell'}
                  </button>
                </div>

                {/* Pick how much to sell: a shares slider (owner ask
                    2026-08-11, replacing sell-all-only), the proceeds
                    preview, and one confirm. */}
                {selling && (
                  <div className="ticket-sell-panel">
                    <input
                      type="range"
                      className={`ticket-slider ticket-slider--${p.direction}`}
                      min={0}
                      max={p.shares}
                      step={p.shares / 200 || 1}
                      value={sharesToSell}
                      style={{ ['--slider-pct' as string]: `${sellPct}%` }}
                      onChange={e => setSellShares(parseFloat(e.target.value))}
                      aria-label={`Shares of ${p.direction} to sell`}
                    />
                    <div className="ticket-sell-facts">
                      <span>
                        {Math.round(sellPct)}% · {fmtShares(sharesToSell)} shares
                      </span>
                      <span>≈ {fmt(sellWorth)} cr</span>
                    </div>
                    <button
                      className={`ticket-go ticket-go--${p.direction === 'higher' ? 'lower' : 'higher'}`}
                      disabled={busy !== null || sharesToSell <= 0}
                      onClick={() => void sell(p, sharesToSell)}
                    >
                      {busy === `sell-${p.direction}`
                        ? 'Selling…'
                        : sharesToSell >= p.shares
                          ? `Sell all for ${fmt(sellWorth)} cr`
                          : `Sell ${fmtShares(sharesToSell)} for ${fmt(sellWorth)} cr`}
                    </button>
                  </div>
                )}
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
              <div className="ticket-pos-head">
                <span className={`ticket-pos-dir ticket-pos-dir--${o.direction}`}>
                  {o.direction === 'higher' ? '▲' : '▼'} {o.direction}
                </span>
                <span className="ticket-pos-detail">
                  {o.direction === 'higher' ? 'under' : 'over'} {unit}
                  {fmtValue(o.limitValue)}
                  {' · '}
                  {fmt(o.remainingCredits)} cr waiting
                </span>
                <button className="ticket-sell" disabled={busy !== null} onClick={() => void cancelOrder(o.id)}>
                  {busy === `cancel-${o.id}` ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ticket-head">
        {!manageMode && (
          <div className="ticket-seg" role="group" aria-label="Direction">
            <button
              className={`ticket-side ticket-side--lower${dir === 'lower' ? ' is-active' : ''}`}
              aria-pressed={dir === 'lower'}
              onClick={() => pick('lower')}
            >
              <span className="ticket-side-word">Lower</span>
              {lowerCeiling !== null && <span className="ticket-side-max">up to {lowerCeiling}</span>}
            </button>
            <button
              className={`ticket-side ticket-side--higher${dir === 'higher' ? ' is-active' : ''}`}
              aria-pressed={dir === 'higher'}
              onClick={() => pick('higher')}
            >
              <span className="ticket-side-word">Higher</span>
              {higherCeiling !== null && <span className="ticket-side-max">up to {higherCeiling}</span>}
            </button>
          </div>
        )}

        {/* The price question lives in the header, Manifold-style, but only
            once a side exists to ask it about (owner direction 2026-08-10:
            an untouched ticket asks one question). */}
        {dir && canLimit && (
          <div className="ticket-mode" role="group" aria-label="Order type">
            <button
              className={`ticket-mode-opt${!isLimit ? ' is-active' : ''}`}
              aria-pressed={!isLimit}
              onClick={() => {
                setMode('quick');
                setError('');
              }}
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
        {(dir || onClose) && (
          <button className="ticket-close" aria-label="Close" onClick={() => (onClose ? onClose() : setDir(null))}>
            ×
          </button>
        )}
      </div>

      {/* What a share has to beat, drawn rather than said. The track's own
          ends carry what the payout sentence used to (a credit at the top,
          nothing at the bottom) and the mark says where a share bought this
          second breaks even, which is wherever the market already is. The
          floor's verbs keep the sentence, having no track to carry it. */}
      {!manageMode && !dir && rangeMin !== undefined && rangeMax !== undefined && consensus !== null && (
        <PayoffLine
          unit={unit}
          rangeMin={rangeMin}
          rangeMax={rangeMax}
          consensus={consensus}
          direction={null}
          breakeven={null}
          shares={null}
          spend={null}
        />
      )}

      {dir && (
        <>
          {/* The stake and the value it buys, on one line, either of which
          a trader can type into (owner, 2026-09-01: "X cr -> {X} value
          above the slider where the user can edit both the input fields").
          Typing a stake spends a budget; typing a value bets to it and the
          stake becomes the cost of getting there. Still no box and no
          stepper chips: the underline is the input. */}
          <div className="compose">
            <label className="compose-fld">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount}
                style={{ width: `${Math.max(1, amount.length)}ch` }}
                onChange={e => {
                  setAmount(e.target.value.replace(/[^0-9]/g, ''));
                  setTarget(null);
                }}
                aria-label="Credits to spend"
              />
              <span className="compose-u">cr</span>
            </label>
            {hasPayoff && targetInput !== null && (
              <>
                <span className="compose-arrow" aria-hidden="true">
                  &rarr;
                </span>
                <span className="compose-fld">
                  {unit}
                  {targetInput}
                </span>
              </>
            )}
          </div>
          {/* The track is logarithmic (lib/bet-slider.ts): the ceiling is the
          whole balance, and linearly that crams every sensible stake into
          the leftmost pixels (user report 2026-08-21). */}
          <input
            className={`ticket-slider ticket-slider--${dir}`}
            type="range"
            min={0}
            max={SLIDER_STEPS}
            value={amountToSlider(amountNum, maxBet)}
            style={(() => {
              const p = (amountToSlider(amountNum, maxBet) / SLIDER_STEPS) * 100;
              return { ['--slider-pct' as string]: `${p.toFixed(2)}%` };
            })()}
            onChange={e => {
              setAmount(String(sliderToAmount(parseInt(e.target.value, 10), maxBet)));
              setTarget(null);
            }}
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

          {/* The order the numbers actually sit in. A resting order pushes
              nothing, so it draws no push mark and the limit is the whole
              answer (docs/ui-conventions.md, "The payoff line puts those
              numbers in an order"). Manage mode has its own line above,
              drawn against the position rather than against a new bet, and
              two tracks in one card would be one too many. */}
          {!manageMode && rangeMin !== undefined && rangeMax !== undefined && consensus !== null && (
            <PayoffLine
              unit={unit}
              rangeMin={rangeMin}
              rangeMax={rangeMax}
              consensus={consensus}
              direction={dir}
              breakeven={winFacts ? winFacts.breakeven : null}
              shares={winFacts ? winFacts.maxPayout : null}
              spend={winFacts ? winFacts.spend : null}
            />
          )}

          {!hasPayoff && (
            <div className="ticket-facts">
              {!isLimit && newValue !== null && consensus !== null && span !== null && rangeMin !== undefined && (
                <div className="ticket-fact">
                  <span className="ticket-fact-k">New value</span>
                  <span className="ticket-fact-v">
                    {unit}
                    {targetInput}
                    <span className={`ticket-fact-d ${newValue >= consensus ? 'is-up' : 'is-down'}`}>
                      {' '}
                      {newValue >= consensus ? '↑' : '↓'}
                      {unit}
                      {fmtValue(Math.abs(newValue - consensus))}
                    </span>
                  </span>
                </div>
              )}
              {winFacts && step !== null && (
                <>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">
                      {isLimit ? 'Once filled, wins' : 'Wins'} {dir === 'higher' ? 'above' : 'below'}
                    </span>
                    <span className="ticket-fact-v">
                      {unit}
                      {fmtValue(winFacts.breakeven)}
                    </span>
                  </div>
                  <div className="ticket-fact">
                    <span
                      className="ticket-fact-k"
                      title={`One credit per share if the number lands at the ${dir === 'higher' ? 'top' : 'bottom'} of the range; less in between`}
                    >
                      Up to
                    </span>
                    <span className="ticket-fact-v">
                      {fmt(winFacts.maxPayout)} cr{' '}
                      <span className="ticket-fact-d is-up">
                        +
                        {Math.round(
                          winFacts.spend > 0 ? ((winFacts.maxPayout - winFacts.spend) / winFacts.spend) * 100 : 0,
                        )}
                        %
                      </span>
                    </span>
                  </div>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">
                      Each {unit}
                      {stepLabel(step)} beyond
                    </span>
                    <span className="ticket-fact-v">
                      <span className="ticket-fact-d is-up">+{fmt(winFacts.slope)} cr</span>
                    </span>
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
          )}

          {/* A resting order says one thing the picture cannot: that the
              credits sit there until it fills. */}
          {hasPayoff && isLimit && !limitError && (
            <div className="ticket-facts">
              <div className="ticket-fact">
                <span className="ticket-fact-k">Until filled</span>
                <span className="ticket-fact-v">{amountNum} cr waits, cancel anytime</span>
              </div>
            </div>
          )}

          {/* The ceiling, where it is felt (owner ask 2026-08-30). The
              slider maxes at the balance, so a trader meets this wall the
              first time they try to say something meaningful, and that is
              the one honest place to mention there is more to earn. Shown
              only at the ceiling, so it never nags somebody with room, and
              only when this account actually has something unclaimed. */}
          {earnAvailable !== null && balance != null && balance > 0 && amountNum >= balance && (
            <p className="ticket-ceiling">
              That is your whole balance &middot;{' '}
              <Link to="/earn">earn {Math.round(earnAvailable).toLocaleString('en-US')} more</Link>
            </p>
          )}

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
