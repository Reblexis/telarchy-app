import { type CSSProperties, type PointerEvent as ReactPointerEvent, useState } from 'react';
import { formatMetricValue } from '../lib/market-quote';

/**
 * The payoff line (docs/ui-conventions.md, "The payoff line is a rule with
 * two rows").
 *
 * One rule across the market's range, carrying exactly two rows of type:
 * what the bet is worth above it, and where the number would have to settle
 * below it. Nothing else (owner, 2026-09-01: "i want the visualization line
 * to only show on top the credit gains/losses and on bottom the different
 * values it settles at thats it"). The rule changes colour where the bet
 * starts paying, which is the break-even, and that stop is the one reading
 * "0 cr".
 *
 * BOTH ENDS OF THE RANGE ARE ALWAYS STOPS. The version this replaces chose
 * its stops at the quarters of the range and dropped any that came near the
 * break-even, so a bet breaking even at 86% of its range lost the top stop
 * and every credit figure on the ticket read as a loss: it never showed
 * that the bet could win at all. The ends carry the two numbers that decide
 * whether a bet is worth making, so they are fixed, the break-even is
 * fixed, and the interior stops fill whatever room is left between them.
 */

/** The closest two stops may sit before their labels would touch. */
const MIN_GAP = 0.13;
/**
 * The interior stops, at fixed thirds of the range.
 *
 * Fixed is the whole point. Spacing them off the break-even meant every drag
 * of the stake slider moved the break-even, and every label slid sideways
 * with it (owner, 2026-09-01: "the numbers are kind of twitching when i move
 * the slider"). At fixed thirds only the break-even's own label travels,
 * which is honest, because it is the only one that is actually moving.
 */
const INTERIOR = [1 / 3, 2 / 3];

interface Props {
  unit: string;
  rangeMin: number;
  rangeMax: number;
  /** Where the market stands right now, for the untouched bar. */
  consensus: number;
  /** The side this is about; null is an untouched ticket, which has no bet
      to price and shows the plain range bar instead. */
  direction: 'higher' | 'lower' | null;
  /** The settled value at which the bet, or the held position, breaks even. */
  breakeven: number | null;
  /** The shares the bet buys (or the position holds) and what they cost,
      which is all the pricing needs: payout is linear in the settled value. */
  shares: number | null;
  spend: number | null;
}

/**
 * One format for every value on the line, so the row cannot come out ragged.
 *
 * A scale reading "0, 33.3, 66.7, 84, 100" makes the one that happens to land
 * on a whole number look like a different kind of number (owner, 2026-09-01:
 * "show the numbers with fixed decimal number count now when its e.g. 84.0 it
 * shows as 84"). So the whole row shares a divisor, taken from its largest
 * value, and a decimal count: one if any value on the line needs one, none if
 * none of them does.
 */
function scaleFormatter(values: number[], unit: string): (v: number) => string {
  const top = Math.max(...values.map(Math.abs));
  const [divisor, suffix] = top >= 1e9 ? [1e9, 'B'] : top >= 1e6 ? [1e6, 'M'] : top >= 1e4 ? [1e3, 'k'] : [1, ''];
  const scaled = values.map(v => v / divisor);
  const decimals = scaled.some(v => Math.abs(v - Math.round(v)) >= 0.05) ? 1 : 0;
  return (v: number) =>
    `${unit}${(v / divisor).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;
}

/**
 * Where a stop's two labels sit. The ends pin to the card so nothing hangs
 * off it, and a stop near an edge leans away from that edge rather than
 * straddling the pinned label next to it.
 */
function stopStyle(pct: number, first: boolean, last: boolean): CSSProperties {
  if (first) return { left: 0 };
  if (last) return { right: 0 };
  if (pct < 18) return { left: `${pct}%` };
  if (pct > 82) return { left: `${pct}%`, transform: 'translateX(-100%)' };
  return { left: `${pct}%`, transform: 'translateX(-50%)' };
}

/**
 * The fractions to price: both ends of the range always, the break-even
 * always, and the fixed thirds wherever the break-even leaves room for
 * them.
 */
function stopFractions(beF: number): number[] {
  const be = beF > MIN_GAP && beF < 1 - MIN_GAP ? [beF] : [];
  const interior = INTERIOR.filter(f => be.length === 0 || Math.abs(f - beF) >= MIN_GAP);
  return [0, ...interior, ...be, 1].sort((a, b) => a - b);
}

export function PayoffLine({ unit, rangeMin, rangeMax, consensus, direction, breakeven, shares, spend }: Props) {
  /** Where the pointer is reading, as a fraction of the range. */
  const [read, setRead] = useState<number | null>(null);

  const span = rangeMax - rangeMin;
  if (!(span > 0) || !Number.isFinite(consensus)) return null;

  const pct = (v: number) => Math.round(Math.min(100, Math.max(0, ((v - rangeMin) / span) * 100)) * 100) / 100;
  const money = (v: number) => `${unit}${formatMetricValue(v)}`;
  const priced =
    direction !== null && breakeven !== null && shares !== null && spend !== null && shares > 0 && spend > 0;

  // Nothing composed: the range, and where the market sits in it. A share
  // bought this second breaks even exactly there, which is the only honest
  // thing to say before a stake exists.
  if (!priced) {
    const nowPct = pct(consensus);
    return (
      <div className="pay">
        <div className="pay-track-wrap">
          <div className="pay-track">
            <div className="pay-win pay-win--lower" style={{ left: '0%', right: `${100 - nowPct}%` }} />
            <div className="pay-win pay-win--higher" style={{ left: `${nowPct}%`, right: '0%' }} />
          </div>
          <div className="pay-mark pay-mark--now" style={{ left: `${nowPct}%` }} title={`Now ${money(consensus)}`} />
        </div>
        <div className="pay-ends">
          <span>{money(rangeMin)}</span>
          <span>{money(rangeMax)}</span>
        </div>
      </div>
    );
  }

  const beF = Math.min(1, Math.max(0, ((breakeven as number) - rangeMin) / span));
  const bePct = pct(breakeven as number);
  const fractions = stopFractions(beF);
  const worthAt = (f: number) => (shares as number) * (direction === 'higher' ? f : 1 - f) - (spend as number);
  /** `|| 0` is not decoration: rounding a hair below zero gives -0, and the
      break-even stop then flickered between "0 cr" and "-0 cr" as the stake
      moved (owner, 2026-09-01). */
  const credits = (worth: number) => {
    const n = Math.round(worth) || 0;
    return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')} cr`;
  };
  const tone = (worth: number) => {
    const n = Math.round(worth) || 0;
    return n > 0 ? 'up' : n < 0 ? 'down' : 'even';
  };

  const fmtScale = scaleFormatter(
    fractions.map(f => rangeMin + f * span),
    unit,
  );

  const stops = fractions.map((f, i) => {
    const value = rangeMin + f * span;
    const worth = worthAt(f);
    return {
      at: Math.round(f * 10000) / 100,
      value: fmtScale(value),
      credits: credits(worth),
      tone: tone(worth),
      style: stopStyle(Math.round(f * 10000) / 100, i === 0, i === fractions.length - 1),
    };
  });

  /* Hovering the line reads out the exact figure under the pointer. It
     lands in the same two rows the stops use, so nothing is added to the
     card's height and nothing can overlap: the standing labels stand down
     while it is up. */
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0)) return;
    setRead(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const cursorAt = read === null ? null : Math.round(read * 10000) / 100;
  const cursorStyle = cursorAt === null ? undefined : stopStyle(cursorAt, false, false);
  /** The readout says what its two numbers MEAN, because "-13 cr" over
      "$125k" is two facts a reader has to join up for themselves. */
  const says = (worth: number) => {
    const n = Math.round(worth) || 0;
    if (n === 0) return 'you break even';
    return n > 0 ? `you make +${n.toLocaleString('en-US')} cr` : `you lose ${Math.abs(n).toLocaleString('en-US')} cr`;
  };

  return (
    <div
      className={`scale${read === null ? '' : ' is-reading'}`}
      onPointerMove={onMove}
      onPointerLeave={() => setRead(null)}
    >
      <div className="scale-row scale-cr">
        {stops.map(s => (
          <span key={s.at} data-at={String(s.at)} style={s.style}>
            <span className={s.tone}>{s.credits}</span>
          </span>
        ))}
        {read !== null && cursorAt !== null && (
          <span className={`scale-cursor ${tone(worthAt(read))}`} data-at={String(cursorAt)} style={cursorStyle}>
            {says(worthAt(read))}
          </span>
        )}
      </div>
      <div className="rule" aria-hidden="true">
        <div
          className={`rule-lose rule-lose--${direction}`}
          style={{ width: `${direction === 'higher' ? bePct : 100 - bePct}%` }}
        />
        <div
          className={`rule-win rule-win--${direction}`}
          style={{ width: `${direction === 'higher' ? 100 - bePct : bePct}%` }}
        />
        {stops.slice(1, -1).map(s => (
          <div key={s.at} className="rule-tick" style={{ left: `${s.at}%` }} />
        ))}
        {cursorAt !== null && <div className="rule-cursor" style={{ left: `${cursorAt}%` }} />}
      </div>
      <div className="scale-row scale-val">
        {stops.map(s => (
          <span key={s.at} data-at={String(s.at)} style={s.style}>
            {s.value}
          </span>
        ))}
        {read !== null && cursorAt !== null && (
          <span className="scale-cursor" data-at={String(cursorAt)} style={cursorStyle}>
            if it settles at {fmtScale(rangeMin + read * span)}
          </span>
        )}
      </div>
    </div>
  );
}
