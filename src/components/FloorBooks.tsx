import { useEffect, useRef, useState } from 'react';
import { captionLabel, dateSegmentOf, forecastDayOf, type HorizonView } from '../lib/floor-horizons';
import { formatImpact } from '../lib/formatImpact';
import { callLabel } from '../lib/market-quote';
import { short } from './MarketFacts';

/**
 * Books on this floor (docs/ui-conventions.md, "Books on this floor"): the
 * floor is a grid of books, metrics x dates, and every open book is listed
 * once with its call. One component rendered in two places: the left rail
 * from 1400px, and a row under the question below it that opens the same
 * list as a panel. Never two lists.
 */

/** Rows are grouped under their metric's name when the floor has more than this many. */
const GROUP_FROM = 8;

function BookRows({
  horizons,
  workspaceName,
  selectedId,
  onPick,
  role,
}: {
  horizons: HorizonView[];
  workspaceName: string | null;
  selectedId: string | null;
  onPick: (marketId: string) => void;
  role: 'list' | 'listbox';
}) {
  const grouped = horizons.length > GROUP_FROM;
  let lastMetric: string | null = null;
  return (
    <ul
      className={`pubws-books-list${role === 'listbox' ? ' pubws-books-panel' : ''}`}
      role={role === 'listbox' ? 'listbox' : undefined}
      aria-label={role === 'listbox' ? 'Books on this floor' : undefined}
    >
      {horizons.map(h => {
        const selected = h.marketId === selectedId;
        const label = captionLabel(h.metricLabel, workspaceName);
        const heading = grouped && lastMetric !== h.metricId ? label : null;
        lastMetric = h.metricId;
        return (
          <li key={h.marketId} role="none">
            {heading && <span className="pubws-books-group">{heading}</span>}
            <button
              type="button"
              className={`pubws-book${selected ? ' is-selected' : ''}`}
              role={role === 'listbox' ? 'option' : undefined}
              aria-selected={role === 'listbox' ? selected : undefined}
              aria-current={role === 'list' && selected ? 'true' : undefined}
              onClick={() => onPick(h.marketId)}
            >
              <span className="pubws-book-text">
                {!heading && <span className="pubws-book-name">{label}</span>}
                <span className="pubws-book-clock">{dateSegmentOf(h)}</span>
              </span>
              <span className="pubws-book-num">
                <span className="pubws-book-call">
                  {/* A call as a person would say it, "9.4" not "9.40":
                      trailing zeros in a rail of four numbers read as
                      precision the market has not got. */}
                  {h.consensus === null ? 'no price yet' : callLabel(h.unit, h.consensus)}
                </span>
                <span className="pubws-book-pool">{short(h.pool)} cr</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The left rail's list, from 1400px. */
export function BooksList({
  horizons,
  workspaceName,
  selectedId,
  onPick,
  onManage,
}: {
  horizons: HorizonView[];
  workspaceName: string | null;
  selectedId: string | null;
  onPick: (marketId: string) => void;
  /** The owner's way into the metric sheet; null for everyone else. */
  onManage: (() => void) | null;
}) {
  return (
    <section className="pubws-books" aria-label="Books on this floor">
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">Books on this floor</h2>
      </div>
      <BookRows horizons={horizons} workspaceName={workspaceName} selectedId={selectedId} onPick={onPick} role="list" />
      {onManage && (
        <button type="button" className="pubws-books-manage" onClick={onManage}>
          Manage metrics and dates
        </button>
      )}
    </section>
  );
}

/** The soonest settle day among the open books, as the row prints it. */
export function nextSettleOf(horizons: HorizonView[]): string | null {
  const soonest = horizons
    .filter(h => h.resolvesOn)
    .sort((a, b) => new Date(a.resolvesOn!).getTime() - new Date(b.resolvesOn!).getTime())[0];
  return soonest ? forecastDayOf(soonest.resolvesOn) : null;
}

/** The row under the question, below 1400px, opening the same list. */
export function BooksRow({
  horizons,
  workspaceName,
  selectedId,
  onPick,
  onManage,
  proposals,
  onJumpToProposals,
  unit,
}: {
  horizons: HorizonView[];
  workspaceName: string | null;
  selectedId: string | null;
  onPick: (marketId: string) => void;
  onManage: (() => void) | null;
  /** The pending count and the largest absolute impact on the horizon on
   *  screen; null hides the item (no board on this floor). */
  proposals: { count: number; largest: number | null } | null;
  onJumpToProposals: () => void;
  unit: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const next = nextSettleOf(horizons);
  const n = horizons.length;
  return (
    <div className="pubws-books-row" ref={wrapRef}>
      <button
        type="button"
        className="pubws-books-row-go"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="pubws-books-row-word">Books on this floor ▾</span>
        <span className="pubws-books-row-meta">
          {n} {n === 1 ? 'book' : 'books'}
          {next ? ` · next settles ${next}` : ''}
        </span>
      </button>
      {proposals && (
        <button type="button" className="pubws-books-row-props" onClick={onJumpToProposals}>
          {proposals.count} {proposals.count === 1 ? 'proposal' : 'proposals'}
          {proposals.largest !== null ? ` · largest impact ${formatImpact(proposals.largest, unit)}` : ''}
        </button>
      )}
      {open && (
        <div className="pubws-books-pop">
          <BookRows
            horizons={horizons}
            workspaceName={workspaceName}
            selectedId={selectedId}
            onPick={id => {
              onPick(id);
              setOpen(false);
            }}
            role="listbox"
          />
          {onManage && (
            <button
              type="button"
              className="pubws-books-manage"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
            >
              Manage metrics and dates
            </button>
          )}
        </div>
      )}
    </div>
  );
}
