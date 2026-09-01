import type { CSSProperties } from 'react';
import { compactValueOf } from '../lib/floor-horizons';
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
const MIN_GAP = 0.14;
/** Labels, and so stops, that a 480px card has room for. */
const MAX_STOPS = 5;

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
 * The fractions to price: the two ends and the break-even always, then as
 * many evenly spaced interior stops as the gaps between them can hold.
 */
function stopFractions(beF: number): number[] {
  const req = beF > 0.1 && beF < 0.9 ? [0, beF, 1] : [0, 1];
  const gaps = req.slice(0, -1).map((lo, i) => req[i + 1] - lo);
  const take = gaps.map(() => 0);
  let slots = MAX_STOPS - req.length;
  while (slots > 0) {
    let best = -1;
    let bestScore = 0;
    gaps.forEach((g, i) => {
      if (take[i] >= Math.floor(g / MIN_GAP) - 1) return;
      const score = g / (take[i] + 2);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    take[best] += 1;
    slots -= 1;
  }
  const out: number[] = [];
  req.slice(0, -1).forEach((lo, i) => {
    out.push(lo);
    for (let j = 1; j <= take[i]; j += 1) out.push(lo + (gaps[i] * j) / (take[i] + 1));
  });
  out.push(1);
  return out;
}

export function PayoffLine({ unit, rangeMin, rangeMax, consensus, direction, breakeven, shares, spend }: Props) {
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
  const stops = fractions.map((f, i) => {
    const value = rangeMin + f * span;
    const worth = (shares as number) * (direction === 'higher' ? f : 1 - f) - (spend as number);
    const n = Math.round(worth);
    return {
      at: Math.round(f * 10000) / 100,
      value: compactValueOf(value, unit) ?? '',
      credits: `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')} cr`,
      tone: n > 0 ? 'up' : n < 0 ? 'down' : 'even',
      style: stopStyle(Math.round(f * 10000) / 100, i === 0, i === fractions.length - 1),
    };
  });

  return (
    <div className="scale">
      <div className="scale-row scale-cr">
        {stops.map(s => (
          <span key={s.at} data-at={String(s.at)} style={s.style}>
            <span className={s.tone}>{s.credits}</span>
          </span>
        ))}
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
      </div>
      <div className="scale-row scale-val">
        {stops.map(s => (
          <span key={s.at} data-at={String(s.at)} style={s.style}>
            {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
