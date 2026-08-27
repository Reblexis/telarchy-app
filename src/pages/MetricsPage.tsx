import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { useAuth } from '../hooks/useAuth';
import {
  api,
  type MetricsOverview,
  type MetricsOverviewHorizon,
  type MetricsOverviewRow,
  type PublicWorkspace,
} from '../lib/api';

/**
 * telarchy.com/<floor>/metrics: the owner's page (docs/metrics-page.md).
 *
 * Three questions, one screen: what this workspace is measured on, which dates
 * each number is priced for, and how deep each of those markets runs. Anything
 * that is not one of those three belongs elsewhere; money lives on its own page.
 *
 * A chip is a market. Its label carries the date it settles on, because "this
 * week" alone does not say what it resolves against, and the pool underneath is
 * the same number the floor prints. Depth is typed in credits rather than in a
 * multiplier: the owner reads pools in credits, so the control and the thing it
 * moves share a unit (owner direction 2026-08-27, after a weights design he
 * called too confusing).
 */

/** Calendar horizons offered by the picker, resolved at click time. */
const QUICK: Array<{ key: string; label: string; of: (now: Date) => string }> = [
  { key: 'week', label: 'This week', of: now => isoWeek(now) },
  { key: 'month', label: 'This month', of: now => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}` },
  {
    key: 'next-month',
    label: 'Next month',
    of: now => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    },
  },
  { key: 'year', label: 'This year', of: now => String(now.getUTCFullYear()) },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO week of a date, in the YYYY-Www form the API takes. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

/** What the owner calls this date, given how far off it settles. */
function horizonWords(targetDate: string, settlesOn: string): string {
  const end = new Date(settlesOn);
  const now = new Date();
  const days = (end.getTime() - now.getTime()) / 86400000;
  if (/^\d{4}-W\d{2}$/.test(targetDate)) return days <= 7 ? 'This week' : 'A week';
  if (/^\d{4}-\d{2}$/.test(targetDate)) {
    if (days <= 31 && end.getUTCMonth() === now.getUTCMonth()) return 'This month';
    return end.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  }
  if (/^\d{4}$/.test(targetDate)) return targetDate === String(now.getUTCFullYear()) ? 'This year' : targetDate;
  if (/^\d{4}-\d{2}-\d{2}/.test(targetDate)) return days <= 1 ? 'Today' : 'A day';
  return targetDate;
}

function settleWords(settlesOn: string): string {
  return new Date(settlesOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function fmtCredits(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function Chip({
  h,
  floorHref,
  onRemove,
  readOnly,
}: {
  h: MetricsOverviewHorizon;
  floorHref: string;
  onRemove: () => void;
  readOnly: boolean;
}) {
  return (
    <span className="mpg-chip">
      <Link className="mpg-chip-body" to={floorHref}>
        <span className="mpg-chip-when">
          {horizonWords(h.targetDate, h.settlesOn)} · to {settleWords(h.settlesOn)}
        </span>
        <span className="mpg-chip-pool">{fmtCredits(h.pool)} cr</span>
      </Link>
      {!readOnly && (
        <button type="button" className="mpg-chip-x" aria-label={`Close the ${h.targetDate} market`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

function MetricSection({
  row,
  defaultCredits,
  workspaceId,
  floorHref,
  onChanged,
}: {
  row: MetricsOverviewRow;
  defaultCredits: number;
  workspaceId: string;
  floorHref: string;
  onChanged: () => void;
}) {
  const [credits, setCredits] = useState(row.credits === null ? '' : String(row.credits));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCredits(row.credits === null ? '' : String(row.credits));
  }, [row.credits]);

  const dates = row.horizons.map(h => h.targetDate);

  const write = async (body: {
    liquidityCredits?: number | null;
    timePreference?: null | { enabled: boolean; halfLife: number; customHorizons: string[] };
  }) => {
    setBusy(true);
    setErr('');
    try {
      await api.patchMetric(workspaceId, row.id, body);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCredits = () => {
    const trimmed = credits.trim();
    if (trimmed === '') return write({ liquidityCredits: null });
    const n = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      setErr('Credits must be a number, or empty for the workspace default.');
      return;
    }
    if (n === row.credits) return;
    return write({ liquidityCredits: n });
  };

  const setDates = (next: string[]) =>
    write({ timePreference: next.length === 0 ? null : { enabled: false, halfLife: 1, customHorizons: next } });

  const addDate = (date: string) => {
    setPicking(false);
    if (dates.includes(date)) return;
    void setDates([...dates, date]);
  };

  const removeDate = (h: MetricsOverviewHorizon) => {
    // A market with money on it is not closed on one click: the trades are
    // other people's, and closing it voids and refunds them.
    if (h.trades > 0) {
      const ok = window.confirm(
        `${h.trades} ${h.trades === 1 ? 'trade stands' : 'trades stand'} on this market. Closing it voids them and refunds everyone. Close it?`,
      );
      if (!ok) return;
    }
    void setDates(dates.filter(d => d !== h.targetDate));
  };

  const now = new Date();
  const offered = QUICK.map(q => ({ ...q, date: q.of(now) })).filter(q => !dates.includes(q.date));

  return (
    <section className="mpg-metric">
      <div className="mpg-metric-head">
        <span className="mpg-metric-name">{row.name}</span>
        <span className="mpg-metric-range">
          range {fmtCredits(row.rangeMin)}–{fmtCredits(row.rangeMax)}
        </span>
      </div>

      <div className="mpg-metric-sub">
        <span className="mpg-metric-desc">{row.description || 'No definition yet.'}</span>
        <span className="mpg-credits">
          <input
            className="pubws-field-line mpg-credits-input"
            type="text"
            inputMode="decimal"
            aria-label={`Credits a new market on ${row.name} opens with`}
            placeholder={fmtCredits(defaultCredits)}
            value={credits}
            disabled={busy}
            onChange={e => setCredits(e.target.value)}
            onBlur={() => void saveCredits()}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="mpg-credits-unit">cr per new market</span>
        </span>
      </div>

      <div className="mpg-chips">
        {row.horizons.map(h => (
          <Chip key={h.marketId} h={h} floorHref={floorHref} readOnly={row.curve} onRemove={() => removeDate(h)} />
        ))}

        {!row.curve && !picking && offered.length > 0 && (
          <button type="button" className="mpg-add" disabled={busy} onClick={() => setPicking(true)}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 2v8M2 6h8" />
            </svg>
            date
          </button>
        )}

        {picking && (
          <span className="mpg-picker">
            {offered.map(q => (
              <button key={q.key} type="button" className="mpg-picker-btn" onClick={() => addDate(q.date)}>
                {q.label}
              </button>
            ))}
            <button type="button" className="mpg-picker-btn mpg-picker-cancel" onClick={() => setPicking(false)}>
              cancel
            </button>
          </span>
        )}
      </div>

      {row.horizons.length === 0 && !picking && (
        <p className="mpg-none">No market. Add a date and this number gets a price.</p>
      )}
      {row.curve && (
        <p className="mpg-curve">These dates come from this metric's decay curve, so the page leaves them alone.</p>
      )}
      {err && <p className="mpg-err">{err}</p>}
    </section>
  );
}

export function MetricsPage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [data, setData] = useState<MetricsOverview | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loadErr, setLoadErr] = useState('');

  const floorHref = params.workspaceId ? `/marketplace/${params.workspaceId}` : `/${params.slug ?? ''}`;

  useEffect(() => {
    if (!idOrSlug) return;
    let cancelled = false;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(w => {
        if (!cancelled) setWs(w);
      })
      .catch(e => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug]);

  useEffect(() => {
    if (!user || !ws) {
      if (!authLoading && !user) setCanManage(false);
      return;
    }
    api
      .getProfile()
      .then(p => setCanManage(((p as { capabilities?: string[] }).capabilities ?? []).includes('manage')))
      .catch(() => setCanManage(false));
  }, [user, ws, authLoading]);

  const load = useCallback(() => {
    if (!ws?.workspaceId || !canManage) return;
    api
      .getMetricsOverview(ws.workspaceId)
      .then(setData)
      .catch(e => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [ws?.workspaceId, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const priced = useMemo(() => data?.metrics.filter(m => m.horizons.length > 0).length ?? 0, [data]);

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-doc mpg">
        <Link className="annp-back" to={floorHref}>
          {ws?.name ?? params.slug ?? 'Back to the market'}
        </Link>
        <h1 className="annp-head">Metrics</h1>
        <p className="annp-lead">
          What you are measured on, the dates each number gets priced for, and how deep each of those markets runs.
        </p>

        {loadErr && <p className="adm-err">{loadErr}</p>}

        {canManage === false && (
          <p className="mpg-none">
            This page is the owner's. <Link to={floorHref}>The market is open to everyone</Link>.
          </p>
        )}

        {canManage && data && (
          <>
            <div className="pubws-lb-head mpg-top">
              <h2 className="pubws-h2">
                {data.metrics.length} {data.metrics.length === 1 ? 'metric' : 'metrics'}
                {data.metrics.length > 0 && `, ${priced} priced`}
              </h2>
              <span className="pubws-lb-meta">
                {data.autoFund
                  ? `a new market opens with ${fmtCredits(data.defaultCredits)} cr`
                  : 'auto-fund is off: new markets open empty'}
              </span>
            </div>

            {data.metrics.map(row => (
              <MetricSection
                key={row.id}
                row={row}
                defaultCredits={data.defaultCredits}
                workspaceId={ws!.workspaceId}
                floorHref={floorHref}
                onChanged={load}
              />
            ))}

            {data.metrics.length === 0 && <p className="mpg-none">No metrics yet.</p>}

            <p className="mpg-foot">
              Credits come out of your balance when a market opens, never afterwards. Changing a number here changes
              what the next market on that metric opens with, not one already trading.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
