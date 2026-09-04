import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { describeEntry, type HorizonEntry, resolveEntry } from '../lib/horizon-entries';
import type { HorizonCredits, TimePreference } from '../types';
import { AddDateForm, EVERY_ADJECTIVE, parseCredits, WHICH, wholeTimePreference } from './AddDateForm';
import { FloorModal } from './FloorModal';

/**
 * The metrics a floor prices, and one metric's sheet
 * (docs/owner-on-the-floor.md, dialogs 1 and 2).
 *
 * It opens on the list: one line per metric saying what it IS (its range,
 * how many dates, whether anyone is in it). A control that vanished
 * without a trace read as a control that never existed (owner report
 * 2026-09-03: "where do i modify metric raange exactly i dont see tha
 * tsetting anywhere"), so the range lives on the sheet under every metric,
 * always, with the rule printed under the field in the words that apply
 * right now (docs/market-integrity.md, "The range applies from now on").
 *
 * The dates are rows on the sheet itself (owner decision 2026-09-04): each
 * row is one entry of `timePreference.customHorizons` and says what it IS,
 * what is open on it, and two numbers in credits, "Book opens with" and
 * "Proposal opens with", stored on the entry as
 * `timePreference.horizonCredits[entry]`. The proposal number defaults to
 * 0, meaning the proposer funds their own. Save under the rows carries what
 * changed and writes nothing when nothing did. Stopping a date says which
 * of two things it will do before the press (docs/market-integrity.md,
 * "Stopping a date is not destroying a market").
 *
 * Every write is `PUT /api/metrics/:id`: the words, the range and the lag
 * each with their one field; the dates always with the WHOLE
 * timePreference, list and numbers together, so no write can drop what
 * another carries.
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
  spendable,
  initialMetricId,
  onAdd,
  onClose,
  onDone,
}: {
  workspaceId: string;
  /** The open markets on the floor, from the payload the page already has. */
  markets: MetricMarketFacts[];
  /** What a new book opens with when neither the date nor the metric names a number. */
  defaultCredits: number;
  /** What the owner can actually put behind a market: wallet plus balance. */
  spendable: number;
  /** Open straight onto this metric's sheet: the floor's `dates` chip. */
  initialMetricId?: string;
  /** Opens the add form (the page's new-metric dialog). */
  onAdd: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<MetricRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialMetricId ?? null);
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
        spendable={spendable}
        onBack={() => setOpenId(null)}
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

/** What one row's inputs hold, as typed. */
interface RowDraft {
  book: string;
  proposal: string;
}

/** One change a Save would write. */
interface RowChange {
  entry: HorizonEntry;
  kind: 'book' | 'proposal';
  /** null: the book goes back to the standing number. */
  value: number | null;
}

/** "Every month" / "from this month"; "31 December 2026" / "once, 14:00 UTC".
 *  Each row says what it IS rather than when it next lands, because a
 *  repeat and a one-off look identical on the floor. */
function rowWords(e: HorizonEntry): { label: string; sub: string } {
  if (e.every === 'once') {
    const hour = e.entry.match(/T(\d{2})$/);
    const label = e.label.replace(/, once$/, '').replace(/, \d{2}:00 UTC$/, '');
    return { label, sub: hour ? `once, ${hour[1]}:00 UTC` : 'once' };
  }
  const which = WHICH[e.every];
  const sub =
    e.ahead === 0 ? `from ${which[0]}` : e.ahead === 1 ? `from ${which[1]}` : `from ${e.ahead} ${e.every}s ahead`;
  return { label: e.label, sub };
}

/** "the daily book", "the 31 December 2026 book". */
const bookPhrase = (e: HorizonEntry) =>
  e.every === 'once' ? `the ${rowWords(e).label} book` : `the ${EVERY_ADJECTIVE[e.every]} book`;
/** "each weekly proposal", "each proposal on 31 December 2026". */
const proposalPhrase = (e: HorizonEntry) =>
  e.every === 'once' ? `each proposal on ${rowWords(e).label}` : `each ${EVERY_ADJECTIVE[e.every]} proposal`;

/** One metric: its words, its range with the rule under it, its dates as
 *  rows with their two numbers, how long after a period the number is
 *  final, and the way out. */
function MetricSheet({
  workspaceId,
  row,
  markets,
  defaultCredits,
  spendable,
  onBack,
  onClose,
  onDone,
  onRowChange,
}: {
  workspaceId: string;
  row: MetricRow;
  markets: MetricMarketFacts[];
  defaultCredits: number;
  spendable: number;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
  onRowChange: (row: MetricRow) => void;
}) {
  const rangeMax = row.marketRangeMax ?? 1000;
  const lagDays = Math.round(((row.settlementLagMinutes ?? 0) / (24 * 60)) * 10) / 10;
  // What a book falls back to when its date names no number of its own.
  const fallback = row.liquidityCredits ?? defaultCredits;

  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [editingRange, setEditingRange] = useState(false);
  const [range, setRange] = useState(fmtCr(rangeMax));
  const [editingLag, setEditingLag] = useState(false);
  const [lag, setLag] = useState(String(lagDays));
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // The dates: read once, since the write sends customHorizons as a WHOLE
  // array and must never run on a list it has not read (bug hunt
  // 2026-08-31). undefined while reading, null when the metric has none.
  const [stored, setStored] = useState<TimePreference | null | undefined>(undefined);
  const [readErr, setReadErr] = useState('');
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<HorizonEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStored(undefined);
    setReadErr('');
    api
      .getMetric(workspaceId, row.id)
      .then(m => {
        if (cancelled) return;
        const tp = m.timePreference ?? null;
        setStored(tp);
        const next: Record<string, RowDraft> = {};
        for (const entry of tp?.customHorizons ?? []) {
          const hc = tp?.horizonCredits?.[entry];
          next[entry] = {
            book: fmtCr(typeof hc?.book === 'number' ? hc.book : fallback),
            proposal: fmtCr(hc?.proposal ?? 0),
          };
        }
        setDrafts(next);
      })
      .catch(e => {
        if (!cancelled) setReadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, row.id, fallback]);

  const entries = useMemo(() => (stored?.customHorizons ?? []).map(describeEntry), [stored]);
  const credits = stored?.horizonCredits ?? {};
  const factsByDate = useMemo(() => new Map(markets.map(m => [m.targetDate, m])), [markets]);
  const factsFor = (e: HorizonEntry) => factsByDate.get(resolveEntry(e.entry));

  const tradedBooks = markets.filter(traded);
  const anyTraded = tradedBooks.length > 0;

  // --- What a Save would write --------------------------------------------
  // A book number is compared against what the row would open with: a row
  // with no number of its own is prefilled with the fallback, and leaving
  // that as it is (or clearing it) is not a change.
  let invalid = false;
  const changes: RowChange[] = [];
  for (const e of entries) {
    const d = drafts[e.entry];
    if (!d) continue;
    const sb = credits[e.entry]?.book;
    const storedBook = typeof sb === 'number' ? sb : null;
    let draftBook: number | null;
    if (d.book.trim() === '') draftBook = null;
    else {
      const n = parseCredits(d.book);
      if (n === null) {
        invalid = true;
        continue;
      }
      draftBook = storedBook === null && n === fallback ? null : n;
    }
    if (draftBook !== storedBook) changes.push({ entry: e, kind: 'book', value: draftBook });
    const storedProposal = credits[e.entry]?.proposal ?? 0;
    const draftProposal = d.proposal.trim() === '' ? 0 : parseCredits(d.proposal);
    if (draftProposal === null) {
      invalid = true;
      continue;
    }
    if (draftProposal !== storedProposal) changes.push({ entry: e, kind: 'proposal', value: draftProposal });
  }

  const saveLabel = (() => {
    if (changes.length !== 1) return `Save · ${changes.length} changes`;
    const c = changes[0];
    if (c.kind === 'proposal') return `Save · ${fmtCr(c.value ?? 0)} cr behind ${proposalPhrase(c.entry)}`;
    if (c.value === null) return `Save · ${bookPhrase(c.entry)} back to ${fmtCr(fallback)} cr`;
    return `Save · ${fmtCr(c.value)} cr behind ${bookPhrase(c.entry)}`;
  })();

  /** The whole timePreference, for every write of the dates. */
  const writeDates = async (
    list: string[],
    hc: Record<string, HorizonCredits>,
    after: (tp: TimePreference) => void,
  ) => {
    setBusy(true);
    setErr('');
    try {
      const tp = wholeTimePreference(stored, list, hc);
      await api.patchMetric(workspaceId, row.id, { timePreference: tp });
      after(tp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNumbers = () => {
    if (invalid) {
      setErr('A number of credits.');
      return;
    }
    if (changes.length === 0 || stored === undefined) return;
    const hc: Record<string, HorizonCredits> = { ...credits };
    for (const c of changes) {
      const was = hc[c.entry.entry] ?? {};
      hc[c.entry.entry] = c.kind === 'book' ? { ...was, book: c.value } : { ...was, proposal: c.value ?? 0 };
    }
    void writeDates(
      entries.map(e => e.entry),
      hc,
      tp => setStored(tp),
    );
  };

  const stop = (e: HorizonEntry) => {
    const hc: Record<string, HorizonCredits> = { ...credits };
    delete hc[e.entry];
    void writeDates(
      entries.filter(x => x.entry !== e.entry).map(x => x.entry),
      hc,
      () => onDone(),
    );
  };

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
  const lagMinutesOf = (raw: string): number | null => {
    const d = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(d) && d >= 0 ? Math.round(d * 24 * 60) : null;
  };
  const saveLag = () => {
    const minutes = lagMinutesOf(lag);
    if (minutes === null) {
      setErr('A number of days.');
      return;
    }
    void write({ settlementLagMinutes: minutes }, { settlementLagMinutes: minutes }, () => setEditingLag(false));
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

  // --- Stopping one date: the consequence, before the press ----------------
  if (stopping) {
    const facts = factsFor(stopping);
    const isTraded = facts ? traded(facts) : false;
    return (
      <FloorModal onClose={onClose} label="Stop this date">
        <div className="jobform">
          <div className="ticket-head jobform-head">
            <p className="ticket-label">
              Stop {rowWords(stopping).label.toLowerCase()} · {row.name}
            </p>
            <button className="ticket-close" aria-label="Close" onClick={() => setStopping(null)}>
              ×
            </button>
          </div>
          <div className="ticket-facts">
            {facts ? (
              isTraded ? (
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
          <button className="ticket-go" disabled={busy} onClick={() => stop(stopping)}>
            {busy ? 'Stopping…' : isTraded ? 'Stop repeating' : 'Stop and take the pool back'}
            <span className="ticket-go-sub">
              {isTraded
                ? 'It settles on its own date as normal, and the one after it is never opened.'
                : 'Nothing is taken from anyone: nobody was in it.'}
            </span>
          </button>
        </div>
      </FloorModal>
    );
  }

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

  const rangeRule = anyTraded
    ? `${tradedBooks.length} ${tradedBooks.length === 1 ? 'book is' : 'books are'} traded and ${
        tradedBooks.length === 1 ? 'keeps' : 'keep'
      } 0 to ${fmtCr(rangeMax)} to settlement. The new range applies to every book that opens after this, and re-opens the untraded ones at it, pools refunded.`
    : 'Nobody has traded, so this re-opens every book at the new range. Pools come back to whoever funded them.';

  const hasDates = entries.length > 0;
  const formOpen = stored !== undefined && (!hasDates || adding);
  const setDraft = (entry: string, patch: Partial<RowDraft>) =>
    setDrafts(d => ({ ...d, [entry]: { ...(d[entry] ?? { book: '', proposal: '0' }), ...patch } }));

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

        {/* The dates, as rows (docs/owner-on-the-floor.md, dialog 2). */}
        <div className="jobform-field metrics-dates">
          <span className="ticket-label">Dates · each opens a book, and each proposal gets a branch of it</span>
          {stored === undefined && !readErr && <p className="odlg-note-left">Reading the dates…</p>}
          {readErr && <p className="ticket-err">{readErr}</p>}
          {hasDates && (
            <div className="metrics-dates-scroll">
              <table className="metrics-dates-table">
                <thead>
                  <tr>
                    <th>Priced</th>
                    <th>Open now</th>
                    <th className="num">Book opens with</th>
                    <th className="num">Proposal opens with</th>
                    <th aria-label="Stop" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => {
                    const words = rowWords(e);
                    const facts = factsFor(e);
                    const d = drafts[e.entry] ?? { book: '', proposal: '0' };
                    const bookZero = parseCredits(d.book) === 0;
                    const proposalZero = d.proposal.trim() === '' || parseCredits(d.proposal) === 0;
                    return (
                      <tr key={e.entry}>
                        <td>
                          <span className="metrics-dates-what">
                            <span className="dates-what">{words.label}</span>{' '}
                            <span className="dates-sub">{words.sub}</span>
                          </span>
                        </td>
                        <td>
                          <span className="metrics-dates-open">
                            {facts
                              ? `${facts.targetDate} · ${fmtCr(facts.pool)} cr · ${
                                  traded(facts)
                                    ? `${facts.traders} ${facts.traders === 1 ? 'trader' : 'traders'}`
                                    : 'nobody yet'
                                }`
                              : 'no market open on it'}
                          </span>
                        </td>
                        <td className="num">
                          <span className="metrics-dates-cell">
                            <input
                              className={`metrics-dates-input odlg-mono${bookZero ? ' is-zero' : ''}`}
                              value={d.book}
                              placeholder={fmtCr(fallback)}
                              inputMode="decimal"
                              disabled={busy}
                              onChange={ev => setDraft(e.entry, { book: ev.target.value })}
                              aria-label={`Book opens with, ${words.label}`}
                            />
                            <span className="metrics-dates-unit">cr</span>
                          </span>
                        </td>
                        <td className="num">
                          <span className="metrics-dates-cell">
                            <input
                              className={`metrics-dates-input odlg-mono${proposalZero ? ' is-zero' : ''}`}
                              value={d.proposal}
                              placeholder="0"
                              inputMode="decimal"
                              disabled={busy}
                              onChange={ev => setDraft(e.entry, { proposal: ev.target.value })}
                              aria-label={`Proposal opens with, ${words.label}`}
                            />
                            <span className="metrics-dates-unit">cr</span>
                          </span>
                        </td>
                        <td className="num">
                          <button
                            type="button"
                            className="pubws-facts-act"
                            disabled={busy}
                            onClick={() => setStopping(e)}
                          >
                            Stop
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {hasDates && (
            <p className="odlg-note-left metrics-dates-note">
              Both numbers come out of your wallet as each market opens, every time the date comes round. The book is
              yours to fund. A proposal at 0 is funded by whoever proposes it, which is the usual case; put a number
              there when you want its price before they pay for one.
            </p>
          )}
          {hasDates && (changes.length > 0 || invalid) && (
            <button className="ticket-go" disabled={busy} onClick={saveNumbers}>
              {busy ? 'Saving…' : saveLabel}
              <span className="ticket-go-sub">
                Books already open keep what they hold. Add to one from its Inject button on the floor.
              </span>
            </button>
          )}
          {hasDates && !adding && (
            <button type="button" className="pubws-date-add dates-add" onClick={() => setAdding(true)}>
              + Add a date
            </button>
          )}
          {formOpen && (
            <AddDateForm
              workspaceId={workspaceId}
              metricId={row.id}
              stored={stored}
              standingCredits={fallback}
              spendable={spendable}
              settlementLagMinutes={lagMinutesOf(lag) ?? row.settlementLagMinutes ?? 0}
              onCancel={hasDates ? () => setAdding(false) : undefined}
              onDone={onDone}
            />
          )}
        </div>

        <div className="ticket-facts metrics-facts">
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
