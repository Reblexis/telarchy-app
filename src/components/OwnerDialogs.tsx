import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { resolveEntry } from '../lib/horizon-entries';
import type { HorizonCredits, TimePreference } from '../types';
import { AddDateForm, wholeTimePreference } from './AddDateForm';
import { FloorModal } from './FloorModal';

/**
 * The owner's three dialogs (docs/owner-on-the-floor.md, "The v1 controls").
 *
 * Each wears the proposal dialog's anatomy exactly (JobsBoard's jobform: the
 * ticket head with the hero amount and the close, 2px jobform underlines,
 * the ruled ticket-facts rows, one ticket-go whose sub-line carries the
 * consequence), so the owner's dialogs read as siblings of the one dialog
 * every trader already knows. Each does exactly one thing: a metric is a
 * name and what it is; a date is one date and the two numbers behind it; an
 * injection is an amount.
 */

function fmtCr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** The next round number at or above n: 1,000 stays 1,000, 8,400 becomes 9,000.
 *  Used for the range the dialog suggests, so the headroom reads deliberate. */
function roundUpNice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / mag) * mag;
}

function parseCredits(raw: string): number | null {
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The proposal dialog's hero amount, in credits: same head, same block, the
 *  unit after the number the way the floor writes credits. */
function CreditsHero({
  label,
  value,
  onChange,
  disabled,
  ariaLabel,
  onClose,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  ariaLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="ticket-head jobform-head">
      <div className="jobform-askblock">
        <p className="ticket-label">{label}</p>
        <label className="ticket-amt ticket-amt--price jobform-ask">
          <input
            value={value}
            style={{ width: `${Math.max(4, value.length)}ch` }}
            onChange={e => onChange(e.target.value.replace(/[^0-9,]/g, ''))}
            placeholder="0"
            inputMode="numeric"
            aria-label={ariaLabel}
            disabled={disabled}
            required
          />
          <span className="ticket-amt-unit">cr</span>
        </label>
      </div>
      <button className="ticket-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** Dialog 1: a metric is a name and what it is. Nothing else is asked. */
export function NewMetricDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (metric: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    if (!name.trim()) {
      setErr('A name.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const created = await api.createMetricIn(workspaceId, {
        name: name.trim(),
        description: description.trim(),
      });
      // The create response is { ok, id, warnings }: the name comes from the
      // field the owner just typed, never from the reply, which carries none
      // (the next dialog's heading read "undefined" until this, 2026-08-30).
      onCreated({ id: created.id, name: name.trim() });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="New metric">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <div className="jobform-askblock">
            <p className="ticket-label">New metric</p>
          </div>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="jobform-field">
          <span className="ticket-label">Name</span>
          <input
            className="jobform-line jobform-line--title"
            value={name}
            autoFocus
            disabled={busy}
            onChange={e => setName(e.target.value)}
            placeholder="Steam wishlists"
            maxLength={70}
            aria-label="Metric name"
          />
        </label>

        <label className="jobform-field">
          <span className="ticket-label">What is it? The market settles on these words</span>
          <textarea
            className="jobform-line jobform-line--desc"
            value={description}
            disabled={busy}
            onChange={e => setDescription(e.target.value)}
            placeholder="Where the number comes from and what counts, in the words it settles on."
            rows={3}
            aria-label="What the metric is"
          />
        </label>

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add the metric'}
          <span className="ticket-go-sub">Next: give it a date. A metric with no date has no market.</span>
        </button>
      </div>
    </FloorModal>
  );
}

/** Dialog 2: the date right after a metric is created, when the metric has
 *  none (docs/owner-on-the-floor.md, "Adding a date"). The same form the
 *  sheet's rows fold behind "+ Add a date", on its own because a metric
 *  with no date has no market and the flow does not stop before one. */
export function AddDateDialog({
  workspaceId,
  metricId,
  metricName,
  defaultCredits,
  spendable,
  onClose,
  onDone,
}: {
  workspaceId: string;
  metricId: string;
  metricName: string;
  defaultCredits: number;
  /** What the owner can actually put behind a market: wallet plus balance. */
  spendable: number;
  onClose: () => void;
  onDone: () => void;
}) {
  // The stored horizons are the source of truth, never the dates on screen:
  // read before the form goes live, so adding one date cannot drop another.
  const [stored, setStored] = useState<TimePreference | null | undefined>(undefined);
  const [standing, setStanding] = useState<number | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api
      .getMetric(workspaceId, metricId)
      .then(m => {
        if (!live) return;
        setStored(m.timePreference ?? null);
        setStanding(typeof m.liquidityCredits === 'number' ? m.liquidityCredits : null);
      })
      .catch(e => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [workspaceId, metricId]);

  return (
    <FloorModal onClose={onClose} label="Add a date">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <p className="ticket-label">Add a date · {metricName}</p>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {err && <p className="ticket-err">{err}</p>}
        <AddDateForm
          workspaceId={workspaceId}
          metricId={metricId}
          stored={stored}
          standingCredits={standing ?? defaultCredits}
          spendable={spendable}
          onDone={onDone}
        />
      </div>
    </FloorModal>
  );
}

/** A standing number keeps its fraction: the platform's own default is 0.5
 *  a market, and rounding it to 1 would misreport what the owner is about to
 *  replace. Thousands are whole numbers, as everywhere else on the floor. */
function fmtStanding(n: number): string {
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Zero is a valid standing number (new markets open unfunded), so unlike the
 *  amount going in now it is refused only when it is not a number. */
function parseStanding(raw: string): number | null {
  const t = raw.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Dialog 3: inject liquidity into one open market, and, for someone who can
 *  manage the floor, the two numbers of this market's own date row
 *  (docs/owner-on-the-floor.md, "Three numbers for someone who can manage
 *  the floor"): what the book opens with each time this date comes round,
 *  and what a proposal's branch on it opens with, written to
 *  `timePreference.horizonCredits[entry]` before the credits move, only
 *  when changed. A market whose date has no row of its own (a curve date)
 *  falls back to the metric's own `liquidityCredits`, one standing number.
 *  A proposal branch never respawns, so the caller passes no metricId
 *  there and the dialog is one number for all. */
export function InjectLiquidityDialog({
  workspaceId,
  marketId,
  marketLabel,
  pool,
  traders,
  metricId,
  metricName,
  targetDate,
  canManage = false,
  defaultCredits = 0,
  onClose,
  onDone,
}: {
  workspaceId: string;
  marketId: string;
  marketLabel: string;
  pool: number;
  traders: number;
  /** The metric this market respawns on; absent on a proposal branch. */
  metricId?: string;
  metricName?: string;
  /** The market's date, to find its row among the metric's entries. */
  targetDate?: string;
  canManage?: boolean;
  /** The workspace's own default, what a metric with no number opens with. */
  defaultCredits?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('1,000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const amountNum = parseCredits(amount);

  const offersStanding = canManage && !!metricId;
  // What this date opens with today: null until loaded. `entry` is the row
  // the numbers belong to, null when the date has no row of its own.
  const [current, setCurrent] = useState<{ book: number; proposal: number } | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const [stored, setStored] = useState<TimePreference | null>(null);
  const [standing, setStanding] = useState('');
  const [proposal, setProposal] = useState('');
  useEffect(() => {
    if (!offersStanding || !metricId) return;
    let live = true;
    api
      .getMetric(workspaceId, metricId)
      .then(m => {
        if (!live) return;
        const own = m.liquidityCredits;
        const metricNumber = typeof own === 'number' ? own : defaultCredits;
        const tp = m.timePreference ?? null;
        const row = targetDate ? ((tp?.customHorizons ?? []).find(h => resolveEntry(h) === targetDate) ?? null) : null;
        const hc = row ? tp?.horizonCredits?.[row] : undefined;
        const book = typeof hc?.book === 'number' ? hc.book : metricNumber;
        const prop = hc?.proposal ?? 0;
        setStored(tp);
        setEntry(row);
        setCurrent({ book, proposal: prop });
        setStanding(fmtStanding(book));
        setProposal(fmtStanding(prop));
      })
      .catch(e => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [offersStanding, workspaceId, metricId, targetDate, defaultCredits]);
  const standingNum = offersStanding ? parseStanding(standing) : null;
  const proposalNum = offersStanding && entry ? parseStanding(proposal) : null;
  const standingChanged = offersStanding && current !== null && standingNum !== null && standingNum !== current.book;
  const proposalChanged = !!entry && current !== null && proposalNum !== null && proposalNum !== current.proposal;

  const inject = async () => {
    if (amountNum === null) {
      setErr('A number of credits.');
      return;
    }
    if (offersStanding && standingNum === null) {
      setErr('A number of credits for every opening.');
      return;
    }
    if (entry && proposalNum === null) {
      setErr('A number of credits behind each proposal.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      // The standing numbers first: refused, nothing has moved; and once
      // written, a refused injection leaves numbers a retry rewrites
      // without harm. The other order could move credits and lose them.
      if (metricId && (standingChanged || proposalChanged)) {
        if (entry) {
          const credits: Record<string, HorizonCredits> = { ...(stored?.horizonCredits ?? {}) };
          credits[entry] = {
            ...(credits[entry] ?? {}),
            ...(standingChanged && standingNum !== null ? { book: standingNum } : {}),
            ...(proposalChanged && proposalNum !== null ? { proposal: proposalNum } : {}),
          };
          const tp = wholeTimePreference(stored, stored?.customHorizons ?? [], credits);
          await api.patchMetric(workspaceId, metricId, { timePreference: tp });
          setStored(tp);
        } else {
          await api.patchMetric(workspaceId, metricId, { liquidityCredits: standingNum });
        }
        setCurrent({ book: standingNum ?? current?.book ?? 0, proposal: proposalNum ?? current?.proposal ?? 0 });
      }
      await api.injectLiquidity(marketId, amountNum, workspaceId);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const label = `Inject liquidity · ${marketLabel}`;
  const go = amountNum
    ? [
        `Add ${fmtCr(amountNum)} cr`,
        ...(standingChanged && standingNum !== null ? [`${fmtStanding(standingNum)} cr on every opening`] : []),
        ...(proposalChanged && proposalNum !== null ? [`${fmtStanding(proposalNum)} cr behind each proposal`] : []),
      ].join(' · ')
    : 'Add';

  return (
    <FloorModal onClose={onClose} label="Inject liquidity">
      <div className="jobform">
        {offersStanding ? (
          <div className="ticket-head jobform-head">
            <div className="jobform-askblock" style={{ flex: 1 }}>
              <p className="ticket-label">{label}</p>
              <div className={entry ? 'inject-two inject-three' : 'inject-two'}>
                <div className="jobform-askblock">
                  <p className="ticket-label">Now, into this market</p>
                  <label className="ticket-amt ticket-amt--price jobform-ask">
                    <input
                      value={amount}
                      style={{ width: `${Math.max(4, amount.length)}ch` }}
                      onChange={e => setAmount(e.target.value.replace(/[^0-9,]/g, ''))}
                      placeholder="0"
                      inputMode="numeric"
                      aria-label="Credits to add to the pool"
                      disabled={busy}
                      required
                    />
                    <span className="ticket-amt-unit">cr</span>
                  </label>
                </div>
                <div className="jobform-askblock">
                  <p className="ticket-label">{entry ? 'Each time it opens again' : 'And each time it opens again'}</p>
                  <label className="ticket-amt ticket-amt--price jobform-ask">
                    <input
                      value={standing}
                      style={{ width: `${Math.max(4, standing.length)}ch` }}
                      onChange={e => setStanding(e.target.value.replace(/[^0-9,.]/g, ''))}
                      placeholder={current === null ? '…' : '0'}
                      inputMode="decimal"
                      aria-label={
                        entry
                          ? 'Credits the book on this date opens with'
                          : 'Credits every new market on this metric opens with'
                      }
                      disabled={busy || current === null}
                      required
                    />
                    <span className="ticket-amt-unit">cr</span>
                  </label>
                </div>
                {entry && (
                  <div className="jobform-askblock">
                    <p className="ticket-label">Behind each proposal on this date</p>
                    <label className="ticket-amt ticket-amt--price jobform-ask">
                      <input
                        value={proposal}
                        style={{ width: `${Math.max(4, proposal.length)}ch` }}
                        onChange={e => setProposal(e.target.value.replace(/[^0-9,.]/g, ''))}
                        placeholder={current === null ? '…' : '0'}
                        inputMode="decimal"
                        aria-label="Credits behind each proposal on this date"
                        disabled={busy || current === null}
                        required
                      />
                      <span className="ticket-amt-unit">cr</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <button className="ticket-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        ) : (
          <CreditsHero
            label={label}
            value={amount}
            onChange={setAmount}
            disabled={busy}
            ariaLabel="Credits to add to the pool"
            onClose={onClose}
          />
        )}

        <div className="ticket-facts">
          <div className="ticket-fact">
            <span className="ticket-fact-k">In the pool now</span>
            <span className="ticket-fact-v">{fmtCr(pool)} cr</span>
          </div>
          {amountNum !== null && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">After</span>
              <span className="ticket-fact-v">{fmtCr(pool + amountNum)} cr</span>
            </div>
          )}
          <div className="ticket-fact">
            <span className="ticket-fact-k">Traders on it</span>
            <span className="ticket-fact-v">{fmtCr(traders)}</span>
          </div>
          {offersStanding && current !== null && standingNum !== null && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">
                {entry ? 'Next market on this date opens with' : 'Next market on this metric opens with'}
              </span>
              <span className="ticket-fact-v">
                {fmtStanding(standingNum)} cr
                {standingChanged && <span className="inject-was"> · was {fmtStanding(current.book)}</span>}
              </span>
            </div>
          )}
          {entry && current !== null && proposalNum !== null && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">Next proposal on this date opens with</span>
              <span className="ticket-fact-v">
                {fmtStanding(proposalNum)} cr
                {proposalChanged && <span className="inject-was"> · was {fmtStanding(current.proposal)}</span>}
              </span>
            </div>
          )}
        </div>

        {err && <p className="ticket-err">{err}</p>}
        {/* Anyone who can trade may fund a market (owner ask 2026-09-02), so
          this is read by traders too, and a trader is owed the part they do
          not know before they pay rather than afterwards in the standings
          (docs/seasons.md). Liquidity credits go first, then the tradeable
          balance: one direction only, which is why the note names the
          consequence rather than the purse. */}
        <p className="adm-note">
          Credits behind a market are not scored as profit on this market, so funding a book you trade pays you nothing.
          What the market does not pay out comes back to you.
          {offersStanding && entry && (
            <>
              {' '}
              The second number is what the {metricName ?? 'metric'} book on this date opens with, every time it comes
              round, out of your wallet as it opens. The third is what a proposal's market on this date opens with,
              every time it comes round, from your wallet too; at zero, the proposer funds their own.
            </>
          )}
          {offersStanding && !entry && (
            <>
              {' '}
              The second number is what every new {metricName ?? 'market on this metric'}
              {metricName ? ' market' : ''} opens with, every date on it included, out of your wallet as it opens.
            </>
          )}
        </p>
        <button className="ticket-go" disabled={busy} onClick={() => void inject()}>
          {busy ? 'Adding…' : go}
          <span className="ticket-go-sub">
            Harder to move, and pays more to be right. One way only: a pool never thins back out.
          </span>
        </button>
      </div>
    </FloorModal>
  );
}

/** Dialog 0: a floor is a name. Everything else happens on the floor itself:
 *  the first metric, its date, its depth. Opened from the marketplace tile
 *  (owner ask 2026-08-28: "create your own", leading to the empty workspace). */
export function CreateWorkspaceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Receives the new floor's path; the caller navigates. */
  onCreated: (path: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    if (!name.trim()) {
      setErr('A name.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const ws = (await api.createWorkspace({ name: name.trim() })) as { id: string };
      // By id, never by slug. Two 2026-08-28 bounces taught the same lesson
      // twice: /{owner}/{slug} has no route in this app, and the bare /{slug}
      // route resolves an AMBIGUOUS slug to none (slugs are unique per owner,
      // not globally, so anyone's unlisted floor sharing the slug 404s the
      // fresh owner's too). /marketplace/{id} resolves by id, always.
      onCreated(`/marketplace/${ws.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="Create your own">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <div className="jobform-askblock">
            <p className="ticket-label">Your own market</p>
          </div>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="jobform-field">
          <span className="ticket-label">Name: the company, the project, or you</span>
          <input
            className="jobform-line jobform-line--title"
            value={name}
            autoFocus
            disabled={busy}
            onChange={e => setName(e.target.value)}
            placeholder="Meridian"
            maxLength={60}
            aria-label="Floor name"
          />
        </label>

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy} onClick={() => void create()}>
          {busy ? 'Opening…' : 'Open my market'}
          <span className="ticket-go-sub">You add the first number next, then publish it with one button.</span>
        </button>
      </div>
    </FloorModal>
  );
}

/** How a reading's age reads to its owner: the nudge is the age itself. */
function ageOf(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days old`;
}

/**
 * Dialog 4: report a new reading (docs/owner-on-the-floor.md).
 *
 * The owner's most frequent act and, until now, the one with no surface at
 * all: markets settle on the metric's stored value, so a floor whose owner
 * cannot report settles every market on the number it was created with.
 *
 * Two shapes, because the first reading is genuinely different. With a
 * previous reading there is a delta and a market price to compare against,
 * and the market's own number sits directly under the one being typed. With
 * none, both are absent and what replaces them is the range: the last moment
 * it can move, since machinery freezes the instant someone trades
 * (docs/market-integrity.md).
 */
export function ReportValueDialog({
  workspaceId,
  metricId,
  metricName,
  unit = '',
  lastValue,
  lastAt,
  marketSays,
  settlesLabel,
  rangeMax,
  rangeEditable,
  periodLabel,
  periodEnd,
  onClose,
  onDone,
}: {
  workspaceId: string;
  metricId: string;
  metricName: string;
  unit?: string;
  /** The last reported reading, or null when the metric has never been read. */
  lastValue: number | null;
  lastAt: string | null;
  /** What the market currently prices, so the owner sees it before reporting. */
  marketSays: number | null;
  /** e.g. "Sunday", for the one market this reading currently decides. */
  settlesLabel: string | null;
  rangeMax: number;
  /**
   * True while every market on this metric is untraded, which is exactly when
   * `docs/market-integrity.md` still lets the machinery move. It is not the
   * same as "no reading yet": creating a metric logs one, so keying the range
   * on the first reading left an owner whose number was 4,200 with a market
   * priced inside 0 to 1,000 and no control that could widen it
   * (walkthrough, 2026-08-30).
   */
  rangeEditable: boolean;
  /** The period the market on screen settles for, said the way the floor says
   *  it ("September", "31 Dec"). */
  periodLabel?: string | null;
  /** The last instant of that period, ISO. Present once the period has
   *  closed, which is when dating a reading into it is the whole point
   *  (owner ask 2026-08-31). */
  periodEnd?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const first = lastValue === null;
  const [value, setValue] = useState(first ? '' : fmtCr(lastValue));
  const [note, setNote] = useState('');
  // WHEN this reading was true, which is not always now: "September finished
  // at 4,812" is typed in October and belongs to September, and a number
  // nobody filed on Friday belongs to Friday (owner ask 2026-08-31). The
  // checkbox is the one-press version for a closed period; the day and hour
  // under it file any past moment. Both empty means now, which is what almost
  // every report is.
  const [backdate, setBackdate] = useState(false);
  const [asOfDay, setAsOfDay] = useState('');
  const [asOfHour, setAsOfHour] = useState('');
  // "It does not exist for this period", which is not zero: an implied
  // valuation with no round closed is not a company worth nothing (owner ask
  // 2026-09-01). The market voids and refunds instead of paying whoever bet
  // low on a fact nobody established.
  const [na, setNa] = useState(false);
  const [range, setRange] = useState(fmtCr(rangeMax));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Where this reading is filed. Null means now, and the request carries no
  // asOf at all, which is the shape every existing caller sends.
  const asOfInstant = (() => {
    if (backdate && periodEnd) return periodEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay)) return null;
    const hh = asOfHour ? asOfHour.slice(0, 5) : '23:59';
    const d = new Date(`${asOfDay}T${hh}:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return null;
    return d.toISOString();
  })();
  const asOfInFuture = !backdate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDay) && asOfInstant === null;

  const parsed = Number(value.replace(/,/g, '').trim());
  const valid = value.trim() !== '' && Number.isFinite(parsed);
  const delta = valid && lastValue !== null ? parsed - lastValue : null;
  // A reading above the top of the band settles as though it landed exactly
  // on it (lib/amm.ts: the settlement probability is clamped), so a number
  // outside the range is a wrong settlement waiting to happen. While the
  // machinery is still movable the dialog raises the suggestion itself, with
  // headroom, until the owner types their own; once it is frozen it says
  // plainly what will happen instead.
  const suggested = valid && parsed > 0 ? roundUpNice(parsed * 2) : null;
  const shownRange =
    rangeEditable && !rangeTouched && suggested !== null && suggested > rangeMax ? fmtCr(suggested) : range;
  const shownRangeNum = parseCredits(shownRange);
  const overRange = valid && parsed > rangeMax;

  const report = async () => {
    if (!valid && !na) {
      setErr('A number.');
      return;
    }
    if (rangeEditable && shownRangeNum === null) {
      setErr('The highest it could plausibly reach.');
      return;
    }
    if (rangeEditable && shownRangeNum !== null && shownRangeNum < parsed) {
      setErr('The range has to reach the number you are reporting.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.reportMetricValue(workspaceId, metricId, {
        ...(na ? { na: true } : {}),
        value: parsed,
        oldValue: lastValue ?? 0,
        updateNote: note.trim(),
        ...(asOfInstant ? { asOf: asOfInstant } : {}),
        ...(rangeEditable && shownRangeNum !== null && shownRangeNum !== rangeMax
          ? { marketRangeMax: shownRangeNum }
          : {}),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="Report the number">
      <div className="jobform">
        <div className="ticket-head jobform-head">
          <div className="jobform-askblock">
            <p className="ticket-label">
              {first ? 'First reading' : 'New reading'} · {metricName}
            </p>
            <label className="ticket-amt ticket-amt--price jobform-ask">
              {unit && <span className="ticket-amt-unit">{unit}</span>}
              <input
                value={value}
                style={{ width: `${Math.max(4, value.length || 4)}ch` }}
                onChange={e => setValue(e.target.value.replace(/[^0-9.,-]/g, ''))}
                placeholder="0"
                inputMode="decimal"
                aria-label="The new reading"
                autoFocus
                disabled={busy}
                required
              />
            </label>
          </div>
          <button className="ticket-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="ticket-facts">
          {!first && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">
                Since {ageOf(lastAt) ?? 'the last reading'}, when it was {fmtCr(lastValue)}
              </span>
              <span className={`ticket-fact-v${delta === null ? '' : delta >= 0 ? ' is-up' : ' is-down'}`}>
                {delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmtCr(delta)}`}
              </span>
            </div>
          )}
          {!first && marketSays !== null && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">The market has been saying</span>
              <span className="ticket-fact-v">{fmtCr(marketSays)}</span>
            </div>
          )}
          {settlesLabel && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">Decides on {settlesLabel}</span>
              <span className="ticket-fact-v">this market</span>
            </div>
          )}
          {rangeEditable && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">Nobody has traded yet, so this also sets the range</span>
              <span className="ticket-fact-v">0 - {fmtCr(shownRangeNum ?? rangeMax)}</span>
            </div>
          )}
          {!rangeEditable && overRange && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">Above the range this market prices inside</span>
              <span className="ticket-fact-v is-down">
                0 - {fmtCr(rangeMax)}, frozen by trades: it settles at the top
              </span>
            </div>
          )}
        </div>

        {rangeEditable && (
          <label className="jobform-field">
            <span className="ticket-label">Highest it could plausibly reach</span>
            <input
              className="jobform-line odlg-mono"
              value={shownRange}
              disabled={busy}
              onChange={e => {
                setRangeTouched(true);
                setRange(e.target.value.replace(/[^0-9,]/g, ''));
              }}
              aria-label="Highest it could plausibly reach"
            />
            <span className="odlg-note-left">Leave room. Fixed once someone trades.</span>
          </label>
        )}

        <label className="jobform-field">
          <span className="ticket-label">What happened, if anything</span>
          <input
            className="jobform-line"
            value={note}
            disabled={busy}
            onChange={e => setNote(e.target.value)}
            placeholder="the Daily Deal ran Tuesday and Wednesday"
            aria-label="What happened"
          />
        </label>

        {periodEnd && (
          <button
            type="button"
            className={`odlg-backdate${backdate ? ' is-on' : ''}`}
            aria-pressed={backdate}
            onClick={() => setBackdate(v => !v)}
          >
            <span className="odlg-backdate-box" aria-hidden="true">
              {backdate ? '✓' : ''}
            </span>
            <span>
              This is {periodLabel ? `${periodLabel}'s` : "that period's"} number, not today's
              <span className="odlg-note-left">
                Files it at the end of the period, which is what its market settles on.
              </span>
            </span>
          </button>
        )}

        {/* Any past moment, for the reading that was true on Friday and typed
          on Monday. Empty is now. */}
        {!backdate && (
          <label className="jobform-field">
            <span className="ticket-label">When was it true? Leave empty for now</span>
            <span className="odlg-dayrow">
              <input
                type="date"
                className="jobform-line odlg-mono odlg-day"
                value={asOfDay}
                max={new Date().toISOString().slice(0, 10)}
                disabled={busy}
                onChange={e => setAsOfDay(e.target.value)}
                aria-label="The day this reading was true"
              />
              <span className="odlg-or">at</span>
              <input
                type="time"
                className="jobform-line odlg-mono odlg-day"
                value={asOfHour}
                disabled={busy || !asOfDay}
                onChange={e => setAsOfHour(e.target.value)}
                aria-label="The hour it was true, UTC"
              />
              <span className="odlg-or">UTC, the end of that day if you leave it</span>
            </span>
            {asOfInFuture && <span className="odlg-note-left">That is in the future, so it is not a measurement.</span>}
          </label>
        )}

        <button
          type="button"
          className={`odlg-backdate${na ? ' is-on' : ''}`}
          aria-pressed={na}
          onClick={() => setNa(v => !v)}
        >
          <span className="odlg-backdate-box" aria-hidden="true">
            {na ? '✓' : ''}
          </span>
          <span>
            There is no number for this, and that is the answer
            <span className="odlg-note-left">
              Not zero: the market on it voids and everyone gets their credits back.
            </span>
          </span>
        </button>

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy || (!valid && !na)} onClick={() => void report()}>
          {busy ? 'Reporting…' : na ? 'Report it as not existing' : valid ? `Report ${unit}${fmtCr(parsed)}` : 'Report'}
          <span className="ticket-go-sub">
            {na
              ? 'The market that settles on this moment voids as N/A, with every position refunded and the reason published.'
              : asOfInstant
                ? `Filed at ${asOfInstant.slice(0, 16).replace('T', ', ')} UTC, which decides the market that settles on it.`
                : 'Public, timestamped, and kept beside the old one for good.'}
          </span>
        </button>
      </div>
    </FloorModal>
  );
}
