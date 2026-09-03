import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { FloorModal } from './FloorModal';

/**
 * The metrics a floor prices, and one metric's sheet
 * (docs/owner-on-the-floor.md, dialog 1).
 *
 * It opens on the list, the twin of the dates dialog: one line per metric
 * saying what it IS (its range, how many dates, whether anyone is in it).
 * A control that vanished without a trace read as a control that never
 * existed (owner report 2026-09-03: "where do i modify metric raange exactly
 * i dont see tha tsetting anywhere"), so the range lives on the sheet under
 * every metric, always, with the rule printed under the field in the words
 * that apply right now (docs/market-integrity.md, "The range applies from
 * now on"): a traded book keeps its range, everything that opens after this
 * prices inside the new one.
 *
 * Every write is `PUT /api/metrics/:id` with one field. Adding a metric and
 * the dates are the page's own dialogs; this one hands off to them.
 */

function fmtCr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What the page knows about each open market, so a line can say who is in it. */
export interface MetricMarketFacts {
  metricId: string;
  targetDate: string;
  label: string;
  pool: number;
  traders: number;
  tradedVolume: number;
}

interface MetricRow {
  id: string;
  name: string;
  description: string;
  value: number;
  marketRangeMax?: number;
  settlementLagMinutes?: number;
  liquidityCredits?: number | null;
}

const traded = (m: MetricMarketFacts) => m.traders > 0 || m.tradedVolume > 0;

export function MetricsDialog({
  workspaceId,
  markets,
  defaultCredits,
  onOpenDates,
  onAdd,
  onClose,
  onDone,
}: {
  workspaceId: string;
  /** The open markets on the floor, from the payload the page already has. */
  markets: MetricMarketFacts[];
  /** What a new book opens with when the metric names nothing of its own. */
  defaultCredits: number;
  onOpenDates: (metricId: string, metricName: string) => void;
  /** Opens the add form (the page's new-metric dialog). */
  onAdd: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<MetricRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getMetricsIn(workspaceId)
      .then(list => {
        if (cancelled) return;
        setRows(list);
        // An empty floor asks one question first: what is the metric. No
        // list, no chip (docs/owner-on-the-floor.md, dialog 1).
        if (list.length === 0) onAdd();
      })
      .catch(e => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, onAdd]);

  const byMetric = useMemo(() => {
    const map = new Map<string, MetricMarketFacts[]>();
    for (const m of markets) {
      const list = map.get(m.metricId) ?? [];
      list.push(m);
      map.set(m.metricId, list);
    }
    return map;
  }, [markets]);

  const openRow = rows?.find(r => r.id === openId) ?? null;
  if (openRow) {
    return (
      <MetricSheet
        workspaceId={workspaceId}
        row={openRow}
        markets={byMetric.get(openRow.id) ?? []}
        defaultCredits={defaultCredits}
        onBack={() => setOpenId(null)}
        onOpenDates={onOpenDates}
        onClose={onClose}
        onDone={onDone}
        onRowChange={next => setRows(rs => (rs ?? []).map(r => (r.id === next.id ? next : r)))}
      />
    );
  }

  return (
    <FloorModal onClose={onClose} label="Metrics">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <p className="ticket-label">Metrics</p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {rows === null && !err && <p className="odlg-note-left">Reading the metrics…</p>}
        {rows !== null && rows.length > 0 && (
          <div className="ticket-facts">
            {rows.map(r => {
              const ms = byMetric.get(r.id) ?? [];
              const volume = ms.reduce((s, m) => s + m.tradedVolume, 0);
              const anyone = ms.some(traded);
              return (
                <div className="ticket-fact dates-line" key={r.id}>
                  <span className="ticket-fact-k">
                    <span className="dates-what">{r.name}</span>
                    <span className="dates-sub">
                      {`0 - ${fmtCr(r.marketRangeMax ?? 1000)} · ${ms.length} ${ms.length === 1 ? 'date' : 'dates'} · ${
                        anyone ? `${fmtCr(volume)} cr traded` : 'nobody in it yet'
                      }`}
                    </span>
                  </span>
                  <button type="button" className="pubws-facts-act" onClick={() => setOpenId(r.id)}>
                    Open
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {err && <p className="ticket-err">{err}</p>}
        {rows !== null && rows.length > 0 && (
          <button type="button" className="pubws-date-add dates-add" onClick={onAdd}>
            + Add a metric
          </button>
        )}
      </div>
    </FloorModal>
  );
}

/** One metric: its words, its range with the rule under it, its dates, and
 *  the way out. Each line writes its one field. */
function MetricSheet({
  workspaceId,
  row,
  markets,
  defaultCredits,
  onBack,
  onOpenDates,
  onClose,
  onDone,
  onRowChange,
}: {
  workspaceId: string;
  row: MetricRow;
  markets: MetricMarketFacts[];
  defaultCredits: number;
  onBack: () => void;
  onOpenDates: (metricId: string, metricName: string) => void;
  onClose: () => void;
  onDone: () => void;
  onRowChange: (row: MetricRow) => void;
}) {
  const rangeMax = row.marketRangeMax ?? 1000;
  const lagDays = Math.round(((row.settlementLagMinutes ?? 0) / (24 * 60)) * 10) / 10;
  const credits = row.liquidityCredits ?? defaultCredits;

  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [editingRange, setEditingRange] = useState(false);
  const [range, setRange] = useState(fmtCr(rangeMax));
  const [editingLag, setEditingLag] = useState(false);
  const [lag, setLag] = useState(String(lagDays));
  const [editingCredits, setEditingCredits] = useState(false);
  const [creditsDraft, setCreditsDraft] = useState(fmtCr(credits));
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const tradedBooks = markets.filter(traded);
  const anyTraded = tradedBooks.length > 0;

  const write = async (body: Parameters<typeof api.patchMetric>[2], next: Partial<MetricRow>, after?: () => void) => {
    setBusy(true);
    setErr('');
    try {
      await api.patchMetric(workspaceId, row.id, body);
      onRowChange({ ...row, ...next });
      after?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const v = name.trim();
    if (!v || v === row.name) return;
    void write({ name: v }, { name: v });
  };
  const saveDescription = () => {
    const v = description.trim();
    if (v === row.description) return;
    void write({ description: v }, { description: v });
  };
  const saveRange = () => {
    const n = parseNumber(range);
    if (n === null) {
      setErr('A number for the top of the range.');
      return;
    }
    if (n < row.value) {
      setErr('The range has to reach the number.');
      return;
    }
    if (n === rangeMax) {
      setEditingRange(false);
      return;
    }
    void write({ marketRangeMax: n }, { marketRangeMax: n }, onDone);
  };
  const saveLag = () => {
    const d = Number(lag.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(d) || d < 0) {
      setErr('A number of days.');
      return;
    }
    const minutes = Math.round(d * 24 * 60);
    void write({ settlementLagMinutes: minutes }, { settlementLagMinutes: minutes }, () => setEditingLag(false));
  };
  const saveCredits = () => {
    const n = parseNumber(creditsDraft);
    if (n === null) {
      setErr('A number of credits.');
      return;
    }
    void write({ liquidityCredits: n }, { liquidityCredits: n }, () => setEditingCredits(false));
  };

  const removeMetric = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.deleteMetric(row.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // --- Removing the metric: what is in the way, before the press ----------
  if (removing) {
    return (
      <FloorModal onClose={onClose} label="Remove this metric">
        <div className="jobform">
          <div className="ticket-head jobform-head">
            <p className="ticket-label">Remove {row.name}</p>
            <button className="ticket-close" aria-label="Close" onClick={() => setRemoving(false)}>
              ×
            </button>
          </div>
          <div className="ticket-facts">
            {markets.map(m => (
              <div className="ticket-fact" key={m.targetDate}>
                <span className="ticket-fact-k">
                  {m.targetDate}
                  {traded(m) ? ` · ${m.traders} in it` : ' · nobody in it'}
                </span>
                <span className={`ticket-fact-v${traded(m) ? ' is-down' : ''}`}>
                  {traded(m) ? 'in the way' : 'would go, pool back'}
                </span>
              </div>
            ))}
            {markets.length === 0 && (
              <div className="ticket-fact">
                <span className="ticket-fact-k">No market open on it</span>
                <span className="ticket-fact-v">nothing to undo</span>
              </div>
            )}
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
                ? `Not while ${tradedBooks.length} of its markets ${tradedBooks.length === 1 ? 'is' : 'are'} traded.`
                : 'Its markets go with it, and their pools come back to whoever funded them.'}
            </span>
          </button>
        </div>
      </FloorModal>
    );
  }

  const datesLine =
    markets.length === 0
      ? 'no dates yet, so no market'
      : markets
          .map(
            m => `${m.label} (${traded(m) ? `${m.traders} ${m.traders === 1 ? 'trader' : 'traders'}` : 'nobody yet'})`,
          )
          .join(' · ');

  const rangeRule = anyTraded
    ? `${tradedBooks.length} ${tradedBooks.length === 1 ? 'book is' : 'books are'} traded and ${
        tradedBooks.length === 1 ? 'keeps' : 'keep'
      } 0 to ${fmtCr(rangeMax)} to settlement. The new range applies to every book that opens after this, and re-opens the untraded ones at it, pools refunded.`
    : 'Nobody has traded, so this re-opens every book at the new range. Pools come back to whoever funded them.';

  return (
    <FloorModal onClose={onClose} label="Metric">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <p className="ticket-label">
            <button type="button" className="dates-link" onClick={onBack}>
              Metrics
            </button>
            {' · '}
            {row.name}
          </p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="jobform-field">
          <span className="ticket-label">Name</span>
          <input
            className="jobform-line jobform-line--title"
            value={name}
            disabled={busy}
            maxLength={70}
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            aria-label="Metric name"
          />
        </label>

        <label className="jobform-field">
          <span className="ticket-label">What it is · the market settles on these words</span>
          <textarea
            className="jobform-line jobform-line--desc"
            value={description}
            disabled={busy}
            rows={3}
            onChange={e => setDescription(e.target.value)}
            onBlur={saveDescription}
            aria-label="What the metric is"
          />
        </label>

        <div className="jobform-field">
          <span className="dates-add-head metrics-range-head">
            <span className="ticket-label">Range · what a new book prices inside</span>
            {!editingRange && (
              <button
                type="button"
                className="dates-link"
                disabled={busy}
                onClick={() => {
                  setRange(fmtCr(rangeMax));
                  setEditingRange(true);
                }}
              >
                change
              </button>
            )}
          </span>
          <span className="metrics-range odlg-mono">
            <span>0</span>
            <span className="metrics-range-to">to</span>
            {editingRange ? (
              <input
                className="jobform-line odlg-mono metrics-range-field"
                value={range}
                disabled={busy}
                autoFocus
                onChange={e => setRange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveRange();
                }}
                aria-label="Range top"
              />
            ) : (
              <span className="metrics-range-n">{fmtCr(rangeMax)}</span>
            )}
          </span>
          <p className="odlg-note-left metrics-range-rule">{rangeRule}</p>
          {editingRange && (
            <button className="ticket-go" disabled={busy} onClick={saveRange} aria-label="Save the range">
              {busy ? 'Saving…' : 'Save the range'}
              <span className="ticket-go-sub">
                {anyTraded ? 'Nobody in a traded book is touched.' : 'Every open book re-opens at it.'}
              </span>
            </button>
          )}
        </div>

        <div className="ticket-facts metrics-facts">
          <div className="ticket-fact dates-line">
            <span className="ticket-fact-k">
              <span className="dates-what">Dates</span>
              <span className="dates-sub">{datesLine}</span>
            </span>
            <button type="button" className="pubws-facts-act" onClick={() => onOpenDates(row.id, row.name)}>
              Open ›
            </button>
          </div>
          <div className="ticket-fact dates-line">
            <span className="ticket-fact-k">
              <span className="dates-what">Final after each period</span>
              {editingLag ? (
                <span className="dates-sub odlg-dayrow">
                  <input
                    className="jobform-line odlg-mono dates-lag-field"
                    value={lag}
                    disabled={busy}
                    autoFocus
                    onChange={e => setLag(e.target.value)}
                    aria-label="Days after the period"
                  />
                  <span className="odlg-or">days</span>
                </span>
              ) : (
                <span className="dates-sub">
                  {`${lagDays} ${lagDays === 1 ? 'day' : 'days'} · markets already open keep their instant`}
                </span>
              )}
            </span>
            {editingLag ? (
              <button
                type="button"
                className="pubws-facts-act"
                disabled={busy}
                onClick={saveLag}
                aria-label="Save the lag"
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                className="pubws-facts-act"
                disabled={busy}
                onClick={() => {
                  setLag(String(lagDays));
                  setEditingLag(true);
                }}
                aria-label="Change the lag"
              >
                change
              </button>
            )}
          </div>
          <div className="ticket-fact dates-line">
            <span className="ticket-fact-k">
              <span className="dates-what">A new book opens with</span>
              {editingCredits ? (
                <span className="dates-sub odlg-dayrow">
                  <input
                    className="jobform-line odlg-mono metrics-credits-field"
                    value={creditsDraft}
                    disabled={busy}
                    autoFocus
                    onChange={e => setCreditsDraft(e.target.value)}
                    aria-label="Credits a new book opens with"
                  />
                  <span className="odlg-or">cr</span>
                </span>
              ) : (
                <span className="dates-sub">
                  {`${fmtCr(credits)} cr · ${row.liquidityCredits == null ? "the workspace's default" : 'set on this metric'}`}
                </span>
              )}
            </span>
            {editingCredits ? (
              <button
                type="button"
                className="pubws-facts-act"
                disabled={busy}
                onClick={saveCredits}
                aria-label="Save the credits"
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                className="pubws-facts-act"
                disabled={busy}
                onClick={() => {
                  setCreditsDraft(fmtCr(credits));
                  setEditingCredits(true);
                }}
                aria-label="Change the credits"
              >
                change
              </button>
            )}
          </div>
        </div>

        {err && <p className="ticket-err">{err}</p>}

        <div className="dates-foot">
          <span>Every edit to the words is kept and shown.</span>
          <button type="button" className="dates-link dates-remove" onClick={() => setRemoving(true)}>
            Remove the metric
          </button>
        </div>
      </div>
    </FloorModal>
  );
}
