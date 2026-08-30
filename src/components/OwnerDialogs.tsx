import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { settleDayOf } from '../lib/floor-horizons';
import { FloorModal } from './FloorModal';

/**
 * The owner's three dialogs (docs/owner-on-the-floor.md, "The v1 controls").
 *
 * Each wears the contract dialog's anatomy exactly (JobsBoard's jobform: the
 * ticket head with the hero amount and the close, 2px jobform underlines,
 * the ruled ticket-facts rows, one ticket-go whose sub-line carries the
 * consequence), so the owner's dialogs read as siblings of the one dialog
 * every trader already knows. Each does exactly one thing: a metric is a
 * name and what it is; a date is one date and the liquidity behind it; an
 * injection is an amount.
 */

/** The dates the segmented row offers, in the API's own grammar.
 *  Calendar picks are ROLLING entries (+0w rolls into next week's market when
 *  this week's resolves); the picker's day is the one-shot absolute it is. */
function quickDates(now: Date = new Date()): Array<{ label: string; entry: string; preview: string }> {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = new Date(Date.UTC(y, m + 1, 1));
  return [
    { label: 'this week', entry: '+0w', preview: isoWeekOf(now) },
    { label: 'this month', entry: '+0m', preview: `${y}-${pad(m + 1)}` },
    { label: 'next month', entry: '+1m', preview: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}` },
    { label: `end of ${y}`, entry: String(y), preview: String(y) },
  ];
}

function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const DATE_SHAPE = /^(\d{4}|\d{4}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}-\d{2}(T\d{2})?)$/;

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

/** The contract dialog's hero amount, in credits: same head, same block, the
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

/** What the add-date dialog prefills: enough to price, never more than held. */
export function firstMarketCredits(workspaceDefault: number, spendable: number): number {
  // 25 credits is where the setup doctrine stops calling a pool a decoration
  // (lib/setup-spec.ts); below it the workspace default says nothing about
  // what this market should carry.
  const wanted = workspaceDefault >= 25 ? workspaceDefault : 1000;
  const affordable = spendable > 0 ? Math.min(wanted, spendable) : wanted;
  return Math.max(1, Math.floor(affordable));
}

/** Dialog 2: one date, and the liquidity behind it. The same dialog whether
 *  it follows dialog 1 or opens from + date on any metric. */
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
  // Manifold's close-date shape (their close-time-section): preset chips above
  // an always-visible date picker, the chips being shortcuts, never a second
  // mode. Ours differ in one semantic: a chip is a ROLLING entry, a picked day
  // is one-shot, so a day in the picker deselects the chips and clearing it
  // hands them back.
  const [picked, setPicked] = useState<string>('+0w');
  const [day, setDay] = useState('');
  // A UTC hour, '' meaning the whole day. Markets settle on the hour
  // (targetDate YYYY-MM-DDTHH), so the time field carries hours only.
  const [hour, setHour] = useState('');
  // A workspace opens with 0.5 credits per auto-funded market
  // (DEFAULT_MARKET_LIQUIDITY_CREDITS), which the platform's own setup
  // checklist calls a decoration: five credits shove such a market's price
  // across its band. Prefilling that number opened the owner's first market
  // at one credit (walkthrough, 2026-08-30), so the dialog prefills what
  // they can actually put behind it: the workspace's default when it is big
  // enough to price anything, a thousand otherwise, and never more than they
  // hold, since the server refuses what the balance will not cover.
  const [credits, setCredits] = useState(fmtCr(firstMarketCredits(defaultCredits, spendable)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const quick = useMemo(() => quickDates(), []);
  const usingDay = day !== '';
  const entry = usingDay ? (hour ? `${day}T${hour.slice(0, 2)}` : day) : picked;
  const previewDate = usingDay ? day : (quick.find(q => q.entry === picked)?.preview ?? null);
  const settleDay = previewDate && DATE_SHAPE.test(previewDate) ? settleDayOf(previewDate) : null;
  const settleClock = usingDay && hour ? `${hour.slice(0, 2)}:59` : '23:59';
  const creditsNum = parseCredits(credits);

  const open = async () => {
    if (usingDay && !DATE_SHAPE.test(day)) {
      setErr('Pick a date.');
      return;
    }
    if (creditsNum === null) {
      setErr('A number of credits.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      // The stored horizons are the source of truth, never the dates on
      // screen: a curve-generated date echoed back would freeze the curve.
      const metric = await api.getMetric(workspaceId, metricId);
      const tp = metric.timePreference ?? null;
      const existing = tp?.customHorizons ?? [];
      await api.patchMetric(workspaceId, metricId, {
        liquidityCredits: creditsNum,
        timePreference: {
          enabled: tp?.enabled ?? false,
          halfLife: tp?.halfLife ?? 1,
          customHorizons: existing.includes(entry) ? existing : [...existing, entry],
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="Add a date">
      <div className="jobform">
        <CreditsHero
          label={`Liquidity behind ${metricName} · from your ${fmtCr(spendable)} cr`}
          value={credits}
          onChange={setCredits}
          disabled={busy}
          ariaLabel="Credits behind the market"
          onClose={onClose}
        />

        <div className="jobform-field">
          <span className="ticket-label">Priced for</span>
          <span className="pubws-seg odlg-seg" role="group" aria-label="Date">
            {quick.map(q => (
              <button
                key={q.entry}
                type="button"
                className={`pubws-seg-btn${!usingDay && picked === q.entry ? ' is-active' : ''}`}
                aria-pressed={!usingDay && picked === q.entry}
                disabled={busy}
                onClick={() => {
                  setDay('');
                  setHour('');
                  setPicked(q.entry);
                }}
              >
                {q.label}
              </button>
            ))}
          </span>
          <span className="odlg-dayrow">
            <span className="odlg-or">or an exact day</span>
            <input
              className="jobform-line odlg-mono odlg-day"
              type="date"
              value={day}
              disabled={busy}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDay(e.target.value)}
              aria-label="Pick a date"
            />
            <span className="odlg-or">at</span>
            <input
              className="jobform-line odlg-mono odlg-day"
              type="time"
              step={3600}
              value={hour}
              disabled={busy || !usingDay}
              // Markets settle on the hour; minutes typed in a browser that
              // ignores step are snapped rather than silently kept.
              onChange={e => setHour(e.target.value ? `${e.target.value.slice(0, 2)}:00` : '')}
              aria-label="Pick an hour, UTC"
            />
            <span className="odlg-or">UTC, optional</span>
          </span>
        </div>

        {settleDay && (
          <div className="ticket-facts">
            <div className="ticket-fact">
              <span className="ticket-fact-k">Settles</span>
              <span className="ticket-fact-v">
                {settleDay}, {settleClock} UTC, on your last reading
              </span>
            </div>
          </div>
        )}

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy} onClick={() => void open()}>
          {busy ? 'Opening…' : `Open the market${creditsNum ? ` · ${fmtCr(creditsNum)} cr` : ''}`}
          <span className="ticket-go-sub">
            What traders can win. Whatever the market does not pay out comes back when it settles.
          </span>
        </button>
      </div>
    </FloorModal>
  );
}

/** Dialog 3: inject liquidity into one open market. */
export function InjectLiquidityDialog({
  workspaceId,
  marketId,
  marketLabel,
  pool,
  traders,
  onClose,
  onDone,
}: {
  workspaceId: string;
  marketId: string;
  marketLabel: string;
  pool: number;
  traders: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('1,000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const amountNum = parseCredits(amount);

  const inject = async () => {
    if (amountNum === null) {
      setErr('A number of credits.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.injectLiquidity(marketId, amountNum, workspaceId);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="Inject liquidity">
      <div className="jobform">
        <CreditsHero
          label={`Inject liquidity, from your balance · ${marketLabel}`}
          value={amount}
          onChange={setAmount}
          disabled={busy}
          ariaLabel="Credits to add to the pool"
          onClose={onClose}
        />

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
        </div>

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy} onClick={() => void inject()}>
          {busy ? 'Adding…' : amountNum ? `Add ${fmtCr(amountNum)} cr` : 'Add'}
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
          <span className="ticket-go-sub">
            You add the first number next, then publish it with one button.
          </span>
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
  onClose: () => void;
  onDone: () => void;
}) {
  const first = lastValue === null;
  const [value, setValue] = useState(first ? '' : fmtCr(lastValue));
  const [note, setNote] = useState('');
  const [range, setRange] = useState(fmtCr(rangeMax));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
    if (!valid) {
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
        value: parsed,
        oldValue: lastValue ?? 0,
        updateNote: note.trim(),
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
            <span className="odlg-note-left">
              Leave room. Fixed once someone trades.
            </span>
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

        {err && <p className="ticket-err">{err}</p>}
        <button className="ticket-go" disabled={busy || !valid} onClick={() => void report()}>
          {busy ? 'Reporting…' : valid ? `Report ${unit}${fmtCr(parsed)}` : 'Report'}
          <span className="ticket-go-sub">
            Public, timestamped, and kept beside the old one for good.
          </span>
        </button>
      </div>
    </FloorModal>
  );
}
