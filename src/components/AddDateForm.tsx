import { useState } from 'react';
import { api } from '../lib/api';
import { type Every, entryFor, resolveEntry } from '../lib/horizon-entries';
import type { HorizonCredits, TimePreference } from '../types';

/**
 * Adding a date to a metric (docs/owner-on-the-floor.md, "Adding a date").
 *
 * One form, wherever it appears: folded behind "+ Add a date" under the
 * rows of the metric's sheet, and open on its own right after a metric is
 * created (a metric with no date has no market, and the flow does not let
 * the owner stop before one). It asks how often, names the period a repeat
 * starts with, takes a day and an optional UTC hour for once, and carries
 * the two numbers every row carries: what the book opens with, prefilled
 * from the metric's standing number, and what a proposal on it opens with,
 * at 0, which means the proposer funds their own.
 *
 * It writes ONE `PUT /api/metrics/:id`: the entry joins `customHorizons`
 * and its two numbers go to `horizonCredits[entry]`, on the whole
 * timePreference object. The stored horizons are the source of truth, so
 * the form is not live until the caller has read them: sending the array
 * with only the new entry would stop every other date (bug hunt
 * 2026-08-31).
 */

/** Six on one row, the "every" carried by the heading so they fit the
 *  card's width (docs/owner-on-the-floor.md, dialog 2). */
export const EVERY_CHOICES: Array<{ id: Every; label: string }> = [
  { id: 'hour', label: 'hourly' },
  { id: 'day', label: 'daily' },
  { id: 'week', label: 'weekly' },
  { id: 'month', label: 'monthly' },
  { id: 'year', label: 'yearly' },
  { id: 'once', label: 'once' },
];

/** The period a repeat starts with: the current one, or the next. */
export const WHICH: Record<Exclude<Every, 'once'>, [string, string]> = {
  hour: ['this hour', 'next hour'],
  day: ['today', 'tomorrow'],
  week: ['this week', 'next week'],
  month: ['this month', 'next month'],
  year: ['this year', 'next year'],
};

/** "the daily book", "each weekly proposal". */
export const EVERY_ADJECTIVE: Record<Exclude<Every, 'once'>, string> = {
  hour: 'hourly',
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

export function fmtCr(n: number): string {
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Zero is a valid opening number (a book at zero opens unfunded, a
 *  proposal at zero is the proposer's to fund), so only a non-number is
 *  refused. Empty is null, for the caller to decide. */
export function parseCredits(raw: string): number | null {
  const t = raw.replace(/[,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What the form prefills for the book: enough to price, never more than
 *  held. 25 credits is where the setup doctrine stops calling a pool a
 *  decoration (lib/setup-spec.ts); a fresh workspace's 0.5 said nothing
 *  about what a market should carry and opened the owner's first one at a
 *  credit (walkthrough, 2026-08-30). */
export function firstBookCredits(standing: number, spendable: number): number {
  const wanted = standing >= 25 ? standing : 1000;
  const affordable = spendable > 0 ? Math.min(wanted, spendable) : wanted;
  return Math.max(1, Math.floor(affordable));
}

/** The timePreference to send, whole: the curve as stored, the list of
 *  entries, and the numbers per entry. Every write of the dates goes
 *  through this so none of them can drop a field the others carry. */
export function wholeTimePreference(
  stored: TimePreference | null | undefined,
  customHorizons: string[],
  horizonCredits: Record<string, HorizonCredits>,
): TimePreference {
  return {
    enabled: stored?.enabled ?? false,
    halfLife: stored?.halfLife ?? 1,
    ...(stored?.density != null ? { density: stored.density } : {}),
    customHorizons,
    horizonCredits,
  };
}

export function AddDateForm({
  workspaceId,
  metricId,
  stored,
  standingCredits,
  spendable,
  settlementLagMinutes,
  onCancel,
  onDone,
}: {
  workspaceId: string;
  metricId: string;
  /** The metric's stored timePreference: undefined while it is still being
   *  read (the form is not live), null when the metric has none. */
  stored: TimePreference | null | undefined;
  /** What the book falls back to: the metric's liquidityCredits, then the
   *  workspace default. */
  standingCredits: number;
  /** What the owner can actually put behind a market: wallet plus balance. */
  spendable: number;
  /** Rides on the same write when the caller has one to keep. */
  settlementLagMinutes?: number;
  /** When given, the form has a head with "Not now"; absent, it is the
   *  only thing on screen and needs neither. */
  onCancel?: () => void;
  onDone: () => void;
}) {
  const [every, setEvery] = useState<Every>('week');
  const [ahead, setAhead] = useState(0);
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('');
  const [book, setBook] = useState(fmtCr(firstBookCredits(standingCredits, spendable)));
  const [proposal, setProposal] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bookNum = parseCredits(book);
  const proposalNum = parseCredits(proposal);
  const live = stored !== undefined;

  const add = async () => {
    if (every === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setErr('Pick a date.');
      return;
    }
    if (bookNum === null || proposalNum === null) {
      setErr('A number of credits.');
      return;
    }
    // The write sends customHorizons as a WHOLE array, so it must not run
    // before the stored dates have been read. The button is disabled for
    // the same reason; this is the guard that holds if it is ever reached
    // another way.
    if (!live) {
      setErr('Still reading this metric’s dates. One moment.');
      return;
    }
    const entry = entryFor(every, ahead, day, hour);
    const existing = stored?.customHorizons ?? [];
    const list = existing.includes(entry) ? existing : [...existing, entry];
    const credits: Record<string, HorizonCredits> = {
      ...(stored?.horizonCredits ?? {}),
      [entry]: { book: bookNum, proposal: proposalNum },
    };
    setBusy(true);
    setErr('');
    try {
      await api.patchMetric(workspaceId, metricId, {
        ...(settlementLagMinutes !== undefined ? { settlementLagMinutes } : {}),
        timePreference: wholeTimePreference(stored, list, credits),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const startsWith = every === 'once' ? null : WHICH[every][ahead === 0 ? 0 : 1];
  const otherStart = every === 'once' ? null : WHICH[every][ahead === 0 ? 1 : 0];
  const go =
    every === 'once'
      ? `Open the book · ${bookNum === null ? '…' : fmtCr(bookNum)} cr`
      : `Open the ${EVERY_ADJECTIVE[every]} book · ${bookNum === null ? '…' : fmtCr(bookNum)} cr`;
  const goSub =
    every === 'once' ? 'One market, on that date, and nothing after it.' : `A new one opens as each ${every} settles.`;

  return (
    <>
      {onCancel && (
        <div className="dates-add-head">
          <span className="ticket-label">Add a date</span>
          <button type="button" className="dates-link" onClick={onCancel}>
            Not now
          </button>
        </div>
      )}

      <div className="jobform-field">
        <span className="ticket-label">How often</span>
        <span className="pubws-seg odlg-seg dates-seg" role="group" aria-label="How often">
          {EVERY_CHOICES.map(c => (
            <button
              key={c.id}
              type="button"
              className={`pubws-seg-btn${every === c.id ? ' is-active' : ''}`}
              aria-pressed={every === c.id}
              disabled={busy}
              onClick={() => setEvery(c.id)}
            >
              {c.label}
            </button>
          ))}
        </span>
        {every === 'once' ? (
          <span className="odlg-dayrow">
            <input
              type="date"
              className="jobform-line odlg-mono odlg-day"
              value={day}
              disabled={busy}
              onChange={e => setDay(e.target.value)}
              aria-label="Pick a date"
            />
            <span className="odlg-or">at</span>
            <input
              type="time"
              step={3600}
              className="jobform-line odlg-mono odlg-day"
              value={hour}
              disabled={busy || !day}
              // Markets settle on the hour; minutes typed in a browser that
              // ignores step are snapped rather than silently kept.
              onChange={e => setHour(e.target.value ? `${e.target.value.slice(0, 2)}:00` : '')}
              aria-label="Pick an hour, UTC"
            />
            <span className="odlg-or">UTC, optional</span>
          </span>
        ) : (
          <span className="odlg-note-left dates-start">
            Starts with {startsWith},{' '}
            <span className="odlg-mono">{resolveEntry(entryFor(every, ahead, day, hour))}</span>.{' '}
            <button type="button" className="dates-link" disabled={busy} onClick={() => setAhead(ahead === 0 ? 1 : 0)}>
              Start with {otherStart} instead
            </button>
          </span>
        )}
      </div>

      <div className="dates-add-numbers">
        <label className="jobform-field">
          <span className="ticket-label">The book opens with · of your {fmtCr(spendable)} cr</span>
          <span className="odlg-dayrow">
            <input
              className="jobform-line odlg-mono dates-add-field"
              value={book}
              disabled={busy}
              inputMode="decimal"
              onChange={e => setBook(e.target.value)}
              aria-label="Credits behind the book"
            />
            <span className="odlg-or">cr</span>
          </span>
        </label>
        <label className="jobform-field">
          <span className="ticket-label">A proposal on it opens with</span>
          <span className="odlg-dayrow">
            <input
              className="jobform-line odlg-mono dates-add-field"
              value={proposal}
              disabled={busy}
              inputMode="decimal"
              onChange={e => setProposal(e.target.value)}
              aria-label="Credits behind each proposal"
            />
            <span className="odlg-or">cr</span>
          </span>
        </label>
      </div>
      <p className="odlg-note-left">
        {every === 'once' ? 'Once' : `Every ${every}`}, from your wallet as the market opens. Leave the proposal at 0
        and whoever proposes pays for their own price.
      </p>

      {err && <p className="ticket-err">{err}</p>}
      <button className="ticket-go" disabled={busy || !live} onClick={() => void add()}>
        {busy ? 'Opening…' : go}
        <span className="ticket-go-sub">{goSub}</span>
      </button>
    </>
  );
}
