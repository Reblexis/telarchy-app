import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { settleDayOf } from '../lib/floor-horizons';
import { FloorModal } from './FloorModal';

/**
 * The owner's three dialogs (docs/owner-on-the-floor.md, "The v1 controls").
 *
 * Each is the floor's own modal wearing the bet ticket's anatomy, and each
 * does exactly one thing: a metric is a name and what it is; a date is one
 * date and the liquidity behind it; an injection is an amount. Everything a
 * form could also have asked for is either defaulted (range, corrected any
 * time before the first trade) or lives where its effect is visible.
 */

/** The dates the segmented row offers, in the API's own grammar.
 *  Calendar picks are ROLLING entries (+0w rolls into next week's market when
 *  this week's resolves); a typed date is the one-shot absolute it is. */
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

const DATE_SHAPE = /^(\d{4}|\d{4}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}-\d{2})$/;

function fmtCr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function parseCredits(raw: string): number | null {
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
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
      const created = (await api.createMetricIn(workspaceId, {
        name: name.trim(),
        description: description.trim(),
      })) as { id: string; name: string };
      onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <FloorModal onClose={onClose} label="New metric">
      <h2 className="odlg-title">New metric</h2>
      <div className="odlg-stack">
        <label className="odlg-field">
          <span className="ticket-label">Name</span>
          <input
            className="pubws-field-line odlg-center"
            type="text"
            value={name}
            autoFocus
            disabled={busy}
            onChange={e => setName(e.target.value)}
            placeholder="Steam wishlists"
          />
        </label>
        <label className="odlg-field">
          <span className="ticket-label">What is it? The market settles on these words</span>
          <textarea
            className="odlg-textarea"
            rows={3}
            value={description}
            disabled={busy}
            onChange={e => setDescription(e.target.value)}
            placeholder="Where the number comes from and what counts, in the words it settles on."
          />
        </label>
        {err && <p className="odlg-err">{err}</p>}
        <button type="button" className="ticket-go" disabled={busy} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add the metric'}
        </button>
        <p className="odlg-note">Next: give it a date. A metric with no date has no market.</p>
      </div>
    </FloorModal>
  );
}

/** Dialog 2: one date, and the liquidity behind it. The same dialog whether
 *  it follows dialog 1 or opens from + date on any metric. */
export function AddDateDialog({
  workspaceId,
  metricId,
  metricName,
  defaultCredits,
  onClose,
  onDone,
}: {
  workspaceId: string;
  metricId: string;
  metricName: string;
  defaultCredits: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string>('+0w');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [credits, setCredits] = useState(String(Math.round(defaultCredits) || 1000));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const quick = useMemo(() => quickDates(), []);
  const entry = typing ? typed.trim() : picked;
  const previewDate = typing
    ? DATE_SHAPE.test(typed.trim())
      ? typed.trim()
      : null
    : (quick.find(q => q.entry === picked)?.preview ?? null);
  const settleDay = previewDate ? settleDayOf(previewDate) : null;
  const creditsNum = parseCredits(credits);

  const open = async () => {
    if (typing && !DATE_SHAPE.test(typed.trim())) {
      setErr('A date like 2026-09-30, 2026-W40, 2026-11 or 2027.');
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
      <h2 className="odlg-title">Add a date</h2>
      <p className="odlg-sub">{metricName}</p>
      <div className="odlg-stack">
        <div className="odlg-field">
          <span className="ticket-label">Priced for</span>
          <span className="pubws-seg odlg-seg" role="group" aria-label="Date">
            {quick.map(q => (
              <button
                key={q.entry}
                type="button"
                className={`pubws-seg-btn${!typing && picked === q.entry ? ' is-active' : ''}`}
                aria-pressed={!typing && picked === q.entry}
                disabled={busy}
                onClick={() => {
                  setTyping(false);
                  setPicked(q.entry);
                }}
              >
                {q.label}
              </button>
            ))}
            <button
              type="button"
              className={`pubws-seg-btn${typing ? ' is-active' : ''}`}
              aria-pressed={typing}
              disabled={busy}
              onClick={() => setTyping(true)}
            >
              a date…
            </button>
          </span>
          {typing && (
            <input
              className="pubws-field-line odlg-center odlg-datetyped"
              type="text"
              value={typed}
              autoFocus
              disabled={busy}
              onChange={e => setTyped(e.target.value)}
              placeholder="2026-09-30 · 2026-W40 · 2026-11 · 2027"
              aria-label="Typed date"
            />
          )}
          {settleDay && <p className="odlg-note">settles {settleDay}, 23:59 UTC, on your last reading before then</p>}
        </div>

        <div className="odlg-field">
          <span className="ticket-label">Liquidity behind it</span>
          <span className="odlg-amount">
            <input
              className="pubws-field-line odlg-center odlg-amount-input"
              type="text"
              inputMode="decimal"
              value={credits}
              disabled={busy}
              onChange={e => setCredits(e.target.value)}
              aria-label="Credits behind the market"
            />
            <span className="odlg-unit">cr</span>
          </span>
          <p className="odlg-note">what traders can win, and how steady the price holds</p>
        </div>

        {err && <p className="odlg-err">{err}</p>}
        <button type="button" className="ticket-go" disabled={busy} onClick={() => void open()}>
          {busy ? 'Opening…' : `Open the market${creditsNum ? ` · ${fmtCr(creditsNum)} cr` : ''}`}
        </button>
        <p className="odlg-note">Whatever the market doesn't pay out comes back to you when it settles.</p>
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
      <h2 className="odlg-title">Inject liquidity</h2>
      <p className="odlg-sub">{marketLabel}</p>
      <div className="odlg-facts">
        <span>
          <strong>{fmtCr(pool)}</strong>
          <em>in the pool now</em>
        </span>
        <span>
          <strong>{fmtCr(traders)}</strong>
          <em>{traders === 1 ? 'trader on it' : 'traders on it'}</em>
        </span>
      </div>
      <div className="odlg-stack">
        <div className="odlg-field">
          <span className="ticket-label">Add</span>
          <span className="odlg-amount">
            <input
              className="pubws-field-line odlg-center odlg-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              autoFocus
              disabled={busy}
              onChange={e => setAmount(e.target.value)}
              aria-label="Credits to add to the pool"
            />
            <span className="odlg-unit">cr</span>
          </span>
          <p className="odlg-note">
            {amountNum ? `${fmtCr(pool + amountNum)} cr after. ` : ''}The price gets harder to move and being right pays
            more. One way only: a pool never thins back out.
          </p>
        </div>
        {err && <p className="odlg-err">{err}</p>}
        <button type="button" className="ticket-go" disabled={busy} onClick={() => void inject()}>
          {busy ? 'Adding…' : amountNum ? `Add ${fmtCr(amountNum)} cr` : 'Add'}
        </button>
        <p className="odlg-note">From your balance now; what the market doesn't pay out returns when it settles.</p>
      </div>
    </FloorModal>
  );
}
