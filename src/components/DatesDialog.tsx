import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  describeEntry,
  type Every,
  entryFor,
  type HorizonEntry,
  repeatSentence,
  resolveEntry,
} from '../lib/horizon-entries';
import { FloorModal } from './FloorModal';

/**
 * The dates a metric is priced on: what repeats, what does not, and how to
 * stop either (docs/owner-on-the-floor.md, "The dates a metric is priced on").
 *
 * It replaces the add-only dialog, because a list you can only add to is a
 * list you can only get wrong once (owner ask 2026-08-31). The same dialog
 * carries the metric's own removal, since deleting the metric is the same
 * kind of act as stopping its dates and belongs beside them.
 *
 * Everything it does is one call: `PUT /api/metrics/:id` with the horizon
 * list it wants. The server reconciles, and what stopping does to a market
 * already open depends on whether anyone is in it
 * (docs/market-integrity.md, "Stopping a date is not destroying a market"):
 * traded, it runs to its settlement untouched; untraded, it goes and the pool
 * comes back. The dialog says which of those before the press, never after.
 */

/** Six on one row, the "every" carried by the heading so they fit the
 *  card's width (docs/owner-on-the-floor.md, dialog 2). */
const EVERY_CHOICES: Array<{ id: Every; label: string }> = [
  { id: 'hour', label: 'hourly' },
  { id: 'day', label: 'daily' },
  { id: 'week', label: 'weekly' },
  { id: 'month', label: 'monthly' },
  { id: 'year', label: 'yearly' },
  { id: 'once', label: 'once' },
];

const WHICH: Record<Exclude<Every, 'once'>, [string, string]> = {
  hour: ['this hour', 'next hour'],
  day: ['today', 'tomorrow'],
  week: ['this week', 'next week'],
  month: ['this month', 'next month'],
  year: ['this year', 'next year'],
};

function fmtCr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function parseCredits(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What the floor knows about each open market, so a line can say whether
 *  stopping it would take anyone's position away. */
export interface DateMarketFacts {
  targetDate: string;
  pool: number;
  traders: number;
  traded: boolean;
}

export function DatesDialog({
  workspaceId,
  metricId,
  metricName,
  markets,
  defaultCredits,
  spendable,
  onClose,
  onDone,
}: {
  workspaceId: string;
  metricId: string;
  metricName: string;
  /** The open markets on this metric, from the payload the page already has. */
  markets: DateMarketFacts[];
  defaultCredits: number;
  spendable: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [entries, setEntries] = useState<HorizonEntry[] | null>(null);
  const [every, setEvery] = useState<Every>('week');
  const [ahead, setAhead] = useState(0);
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('');
  const [credits, setCredits] = useState(fmtCr(defaultCredits >= 25 ? defaultCredits : 1000));
  // How long after a period this number is final. A monthly total that needs
  // three days of refunds to be true settles three days after the month, not
  // at midnight on the 30th when it cannot exist yet (owner ask 2026-08-31).
  const [lagDays, setLagDays] = useState('0');
  // The field is behind "change" in the footer; the sentence carries the
  // number the rest of the time.
  const [editingLag, setEditingLag] = useState(false);
  // The add form is folded behind one chip while the metric has dates, and
  // open while it has none; that is decided once the dates are read.
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<HorizonEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getMetric(workspaceId, metricId)
      .then(m => {
        if (cancelled) return;
        const stored = (m as { timePreference?: { customHorizons?: string[] } }).timePreference?.customHorizons ?? [];
        setEntries(stored.map(describeEntry));
        const lag = (m as { settlementLagMinutes?: number }).settlementLagMinutes ?? 0;
        setLagDays(String(Math.round((lag / (24 * 60)) * 10) / 10));
      })
      .catch(e => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, metricId]);

  const hasDates = entries !== null && entries.length > 0;
  const formOpen = entries !== null && (!hasDates || adding);

  const factsByDate = useMemo(() => new Map(markets.map(m => [m.targetDate, m])), [markets]);
  const factsFor = (e: HorizonEntry) => factsByDate.get(resolveEntry(e.entry));
  const anyTraded = markets.some(m => m.traded);

  /** `fund` carries the liquidity ONLY when this write opens something. A stop
   *  that sent it was refused by the affordability gate for a market it was
   *  not opening: "you hold 0 credits and this market would open with 1,386",
   *  on a press whose whole purpose was to stop opening markets (preview,
   *  2026-08-31). */
  const write = async (list: string[], fund: boolean, after: () => void) => {
    setBusy(true);
    setErr('');
    try {
      const metric = await api.getMetric(workspaceId, metricId);
      const tp = (metric as { timePreference?: { enabled?: boolean; halfLife?: number } }).timePreference ?? null;
      const lag = Number(lagDays.replace(/[^0-9.]/g, ''));
      await api.patchMetric(workspaceId, metricId, {
        ...(fund ? { liquidityCredits: parseCredits(credits) ?? undefined } : {}),
        ...(Number.isFinite(lag) ? { settlementLagMinutes: Math.round(lag * 24 * 60) } : {}),
        timePreference: {
          enabled: tp?.enabled ?? false,
          halfLife: tp?.halfLife ?? 1,
          customHorizons: list,
        },
      });
      after();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (every === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setErr('Pick a date.');
      return;
    }
    if (parseCredits(credits) === null) {
      setErr('A number of credits.');
      return;
    }
    // The write sends customHorizons as a WHOLE array, so it must not run
    // before the stored dates have been read: `entries ?? []` would send only
    // the new one and the reconcile would read every other date as stopped
    // (bug hunt 2026-08-31). The button is disabled for the same reason; this
    // is the guard that holds if it is ever reached another way.
    if (entries === null) {
      setErr('Still reading this metric\u2019s dates. One moment.');
      return;
    }
    const entry = entryFor(every, ahead, day, hour);
    const list = [...entries.map(e => e.entry)];
    if (!list.includes(entry)) list.push(entry);
    await write(list, true, onDone);
  };

  const stop = async (e: HorizonEntry) => {
    await write(
      (entries ?? []).filter(x => x.entry !== e.entry).map(x => x.entry),
      false,
      onDone,
    );
  };

  const removeMetric = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.deleteMetric(metricId);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // --- Stopping one date: the consequence, before the press ----------------
  if (stopping) {
    const facts = factsFor(stopping);
    const traded = facts?.traded ?? false;
    return (
      <FloorModal onClose={onClose} label="Stop this date">
        <div className="jobform">
          <div className="ticket-head jobform-head">
            <p className="ticket-label">
              Stop {stopping.label.toLowerCase()} · {metricName}
            </p>
            <button className="ticket-close" aria-label="Close" onClick={() => setStopping(null)}>
              ×
            </button>
          </div>
          <div className="ticket-facts">
            {facts ? (
              traded ? (
                <>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">The open one, {facts.targetDate}</span>
                    <span className="ticket-fact-v">keeps running</span>
                  </div>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">
                      {facts.traders} {facts.traders === 1 ? 'trader' : 'traders'}, {fmtCr(facts.pool)} cr in the pool
                    </span>
                    <span className="ticket-fact-v">untouched</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">Nobody has traded it</span>
                    <span className="ticket-fact-v">so it goes</span>
                  </div>
                  <div className="ticket-fact">
                    <span className="ticket-fact-k">{fmtCr(facts.pool)} cr in its pool</span>
                    <span className="ticket-fact-v is-up">back to your wallet</span>
                  </div>
                </>
              )
            ) : (
              <div className="ticket-fact">
                <span className="ticket-fact-k">No market open on it yet</span>
                <span className="ticket-fact-v">nothing to undo</span>
              </div>
            )}
            {stopping.every !== 'once' && (
              <div className="ticket-fact">
                <span className="ticket-fact-k">The next one</span>
                <span className="ticket-fact-v is-down">never opens</span>
              </div>
            )}
          </div>
          {err && <p className="ticket-err">{err}</p>}
          <button className="ticket-go" disabled={busy} onClick={() => void stop(stopping)}>
            {busy ? 'Stopping…' : traded ? 'Stop repeating' : 'Stop and take the pool back'}
            <span className="ticket-go-sub">
              {traded
                ? 'It settles on its own date as normal, and the one after it is never opened.'
                : 'Nothing is taken from anyone: nobody was in it.'}
            </span>
          </button>
        </div>
      </FloorModal>
    );
  }

  // --- Removing the metric -------------------------------------------------
  if (removing) {
    return (
      <FloorModal onClose={onClose} label="Remove this metric">
        <div className="jobform">
          <div className="ticket-head jobform-head">
            <p className="ticket-label">Remove {metricName}</p>
            <button className="ticket-close" aria-label="Close" onClick={() => setRemoving(false)}>
              ×
            </button>
          </div>
          <div className="ticket-facts">
            {markets.map(m => (
              <div className="ticket-fact" key={m.targetDate}>
                <span className="ticket-fact-k">
                  {m.targetDate}
                  {m.traded ? ` · ${m.traders} in it` : ' · nobody in it'}
                </span>
                <span className={`ticket-fact-v${m.traded ? ' is-down' : ''}`}>
                  {m.traded ? 'in the way' : 'would go, pool back'}
                </span>
              </div>
            ))}
          </div>
          {anyTraded && (
            <p className="odlg-note-left">
              A metric cannot be removed while anyone has money on it. Stop the dates that are traded, let them settle,
              and this goes through.
            </p>
          )}
          {err && <p className="ticket-err">{err}</p>}
          <button className="ticket-go" disabled={busy || anyTraded} onClick={() => void removeMetric()}>
            {busy ? 'Removing…' : 'Remove the metric'}
            <span className="ticket-go-sub">
              {anyTraded
                ? `Not while ${markets.filter(m => m.traded).length} of its markets are traded.`
                : 'Its markets go with it, and their pools come back to whoever funded them.'}
            </span>
          </button>
        </div>
      </FloorModal>
    );
  }

  // --- The list first, then one more ---------------------------------------
  const creditsNum = parseCredits(credits);
  const lagShown = lagDays.trim() === '' ? '0' : lagDays.trim();
  const startsWith = every === 'once' ? null : WHICH[every][ahead === 0 ? 0 : 1];
  const otherStart = every === 'once' ? null : WHICH[every][ahead === 0 ? 1 : 0];
  return (
    <FloorModal onClose={onClose} label="Dates">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <p className="ticket-label">Dates · {metricName}</p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {entries === null && !err && <p className="odlg-note-left">Reading the dates…</p>}
        {entries?.length === 0 && (
          <p className="dates-empty">No dates yet, so no market. Pick how often this number is priced.</p>
        )}
        {hasDates && (
          <div className="ticket-facts">
            {entries?.map(e => {
              const facts = factsFor(e);
              return (
                <div className="ticket-fact dates-line" key={e.entry}>
                  <span className="ticket-fact-k">
                    <span className="dates-what">{e.label}</span>
                    <span className="dates-sub">
                      {facts
                        ? `${facts.targetDate} · ${fmtCr(facts.pool)} cr · ${
                            facts.traded
                              ? `${facts.traders} ${facts.traders === 1 ? 'trader' : 'traders'}`
                              : 'nobody yet'
                          }`
                        : 'no market open on it'}
                    </span>
                  </span>
                  <button type="button" className="pubws-facts-act" onClick={() => setStopping(e)}>
                    Stop
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {hasDates && !adding && (
          <button type="button" className="pubws-date-add dates-add" onClick={() => setAdding(true)}>
            + Add a date
          </button>
        )}

        {formOpen && (
          <>
            {hasDates && (
              <div className="dates-add-head">
                <span className="ticket-label">Add a date</span>
                <button type="button" className="dates-link" onClick={() => setAdding(false)}>
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
                    onChange={e => setHour(e.target.value)}
                    aria-label="Pick an hour, UTC"
                  />
                  <span className="odlg-or">UTC, optional</span>
                </span>
              ) : (
                <span className="odlg-note-left dates-start">
                  Starts with {startsWith},{' '}
                  <span className="odlg-mono">{resolveEntry(entryFor(every, ahead, day, hour))}</span>.{' '}
                  <button
                    type="button"
                    className="dates-link"
                    disabled={busy}
                    onClick={() => setAhead(ahead === 0 ? 1 : 0)}
                  >
                    Start with {otherStart} instead
                  </button>
                </span>
              )}
            </div>

            <div className="jobform-field">
              <span className="ticket-label">Liquidity behind each one · of your {fmtCr(spendable)} cr</span>
              <input
                className="jobform-line odlg-mono"
                value={credits}
                disabled={busy}
                onChange={e => setCredits(e.target.value)}
                aria-label="Credits behind the market"
              />
            </div>

            {err && <p className="ticket-err">{err}</p>}
            <button className="ticket-go" disabled={busy} onClick={() => void add()}>
              {busy ? 'Opening…' : `Open the market · ${creditsNum === null ? '—' : fmtCr(creditsNum)} cr`}
              <span className="ticket-go-sub">{repeatSentence(every)}</span>
            </button>
          </>
        )}
        {!formOpen && err && <p className="ticket-err">{err}</p>}

        {/* Two facts about the metric itself, kept quiet: how long after a
          period its number is final (docs/guides/sources.md), and the way out. */}
        <div className="dates-foot">
          {editingLag ? (
            <span className="odlg-dayrow">
              <span className="odlg-or">Final</span>
              <input
                className="jobform-line odlg-mono dates-lag-field"
                value={lagDays}
                disabled={busy}
                autoFocus
                onChange={e => setLagDays(e.target.value)}
                aria-label="Days after the period"
              />
              <span className="odlg-or">days after each period. Open markets keep their day.</span>
            </span>
          ) : (
            <span className="dates-final">
              Final <span className="odlg-mono dates-lag-n">{lagShown}</span> {lagShown === '1' ? 'day' : 'days'} after
              each period ·{' '}
              <button type="button" className="dates-link" onClick={() => setEditingLag(true)}>
                change
              </button>
            </span>
          )}
          <button type="button" className="dates-link dates-remove" onClick={() => setRemoving(true)}>
            Remove metric
          </button>
        </div>
      </div>
    </FloorModal>
  );
}
