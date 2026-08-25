import { useMemo } from 'react';

/**
 * The market, drawing itself (design approved 2026-08-24).
 *
 * The page's hero is not a greeting, it is the instrument every Telarchy
 * market page already leads with, and at the start it is a ghost: the needle
 * drifts because nothing has been priced, the ceiling reads "?" because the
 * operator has not said, and the figure sweeps because there is no figure yet.
 * Every answer sharpens it, and what they end on is the same object, live, at
 * an address. Setting up draws the thing you are getting, which is the whole
 * reason it is worth watching.
 *
 * Every value here comes from `GET /api/setup/checklist` (the market row), so
 * nothing on screen is an illustration: a band with no needle means the market
 * genuinely holds nothing and cannot be traded.
 */

export interface InstrumentMarket {
  metricName: string;
  rangeMin: number;
  rangeMax: number;
  targetDate: string;
  consensus: number | null;
  pool: number;
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** "2026-09" as the month a reader recognises. A bare period string is the
 *  one piece of market vocabulary a first-timer has no reason to know. */
function settleLabel(targetDate: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(targetDate);
  if (!m) return targetDate;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function SetupInstrument({
  market,
  name,
  compact,
}: {
  market: InstrumentMarket | null;
  /** What they said they run, once there is a market to put it over. */
  name?: string | null;
  /** The strip the conversation runs under, rather than the full hero. */
  compact?: boolean;
}) {
  // Where the needle sits, as a share of the band. A market holding nothing
  // has no position to show, so the ghost keeps drifting.
  const at = useMemo(() => {
    if (!market || market.consensus === null) return null;
    const band = market.rangeMax - market.rangeMin;
    if (band <= 0) return null;
    return Math.min(1, Math.max(0, (market.consensus - market.rangeMin) / band));
  }, [market]);

  const priced = at !== null;

  return (
    <div className={`instr${compact ? ' instr--strip' : ''}${priced ? ' is-priced' : ''}`}>
      <div className="instr-read">
        <span className="instr-cap">
          {market ? (name ? `${name} · ${market.metricName}` : market.metricName) : 'A new market'}
        </span>
        <span className="instr-value">
          {market && market.consensus !== null ? (
            nf.format(market.consensus)
          ) : (
            <span className="instr-ghostnum">?,???</span>
          )}
        </span>
        {!compact && (
          <span className="instr-sub">
            {market
              ? priced
                ? `${nf.format(market.pool)} credits behind it`
                : 'nothing behind it yet, so it cannot be traded'
              : 'your number, once you name it'}
          </span>
        )}
      </div>

      <div className="instr-band" aria-hidden="true">
        <span className={`instr-rail${market ? '' : ' is-unset'}`} />
        <span
          className={`instr-needle${priced ? ' is-set' : ''}`}
          style={priced ? { left: `${at * 100}%` } : undefined}
        />
        <span className="instr-end instr-end--min">{market ? nf.format(market.rangeMin) : '0'}</span>
        <span className="instr-end instr-end--max">{market ? nf.format(market.rangeMax) : 'ceiling ?'}</span>
      </div>

      {compact && market && <span className="instr-settles">Settles {settleLabel(market.targetDate)}</span>}
    </div>
  );
}

/**
 * Nine decisions, nine ticks: a progress bar made of the thing being built
 * rather than of a widget.
 */
export function SetupTicks({ items }: { items: Array<{ id: string; label: string; status: 'done' | 'open' }> }) {
  if (!items.length) return null;
  const done = items.filter(i => i.status === 'done').length;
  return (
    <div className="instr-ticks" aria-label={`${done} of ${items.length} decided`}>
      {items.map(i => (
        <span
          key={i.id}
          className={`instr-tick is-${i.status}`}
          title={`${i.label}: ${i.status === 'done' ? 'decided' : 'still open'}`}
        />
      ))}
    </div>
  );
}
