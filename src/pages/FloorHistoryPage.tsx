import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  api,
  type FloorHistory,
  type HistoryBook,
  type HistoryFork,
  type HistoryOption,
  type HistorySettle,
} from '../lib/api';
import { currencyOf, metricLabelOf } from '../lib/floor-horizons';
import { clockOf, countdownTo, dayOf } from '../lib/viewer-time';
import { TopBar } from './TradePage';

/**
 * telarchy.com/<slug>/history: a floor's history as the tree of worlds it is
 * (docs/ui-conventions.md, "A floor's history").
 *
 * The trunk is the world that happened. Every decision is a fork on it: what
 * happened right of the trunk, every world not taken left of it at the price
 * the market gave it when the owner ruled. Every settled book is a square on
 * the trunk, its call against its value. The page draws what
 * GET /api/marketplace/:idOrSlug/history hands it and computes nothing
 * itself; replay only hides what is newer than the thumb.
 */

/** How long play takes to run the loaded span up to now. */
const PLAY_MS = 20_000;

/** Where the node sits in a fork row, and how far apart the worlds not taken
 *  are stacked; the curves strip is drawn in these units. */
const NODE_Y = 26;
const GHOST_Y0 = 10;
const GHOST_STEP = 22;
const CURVES_W = 88;

/** A price at the size the tree prints it: whole above 100, one decimal
 *  above 10, up to two below, with the metric's currency in front. */
function num(v: number | null | undefined, unit = ''): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const a = Math.abs(v);
  const body =
    a >= 1000
      ? Math.round(v).toLocaleString('en-US')
      : a >= 100
        ? String(Math.round(v))
        : a >= 10
          ? String(Math.round(v * 10) / 10)
          : String(Math.round(v * 100) / 100);
  return `${v < 0 ? '-' : ''}${unit}${body.replace(/^-/, '')}`;
}

/** The period a book or a pair is about, in words a reader scans. */
function periodOf(targetDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2})?$/.test(targetDate))
    return clockOf(`${targetDate}${targetDate.length === 13 ? ':00' : ''}:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return dayOf(`${targetDate}T12:00:00Z`);
  const w = targetDate.match(/^\d{4}-W(\d{2})$/);
  if (w) return `week ${Number(w[1])}`;
  const m = targetDate.match(/^(\d{4})-(\d{2})$/);
  if (m)
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleString('en-GB', {
      month: 'short',
      timeZone: 'UTC',
    });
  return targetDate;
}

const whenOf = (iso: string) => `${dayOf(iso)} ${clockOf(iso)}`;

type Tone = 'approved' | 'declined' | 'answer' | 'open';

function toneOf(fork: HistoryFork, o: HistoryOption, open: boolean): Tone {
  if (open) return 'open';
  if (fork.proposals.length > 1) return 'answer';
  return o.label === 'if approved' ? 'approved' : 'declined';
}

const VERDICT_WORD: Record<string, string> = {
  approved: 'approved',
  declined: 'declined',
  lapsed: 'lapsed',
  withdrawn: 'withdrawn',
  chosen: 'chosen',
  none: 'none chosen',
  open: 'being priced',
};

function verdictTone(fork: HistoryFork): string {
  if (fork.verdict === 'open') return ' hist-tone--open';
  if (fork.verdict === 'approved' || fork.verdict === 'chosen') return ' hist-tone--approved';
  if (fork.verdict === 'declined') return ' hist-tone--declined';
  return '';
}

const Icon = {
  user: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
  usd: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5M4 19h16M7 15l4-4 3 3 5-6" />
    </svg>
  ),
};

function ForkRow({ fork, open, now }: { fork: HistoryFork; open: boolean; now: number }) {
  const multi = fork.proposals.length > 1;
  const unit = currencyOf(fork.metric?.name ?? '');
  const taken = fork.options.filter(o => o.taken);
  const ghosts = open ? fork.options : fork.options.filter(o => !o.taken);
  const lead = taken[0] ?? null;
  const head = multi ? (fork.proposals.find(p => p.id === lead?.proposalId) ?? fork.proposals[0]) : fork.proposals[0];
  const reason = !multi ? fork.proposals[0]?.declineReason : null;
  const takenPrice = lead ? num(lead.price, unit) : null;
  const deadline = open ? head?.decideBy : null;
  const clock = deadline ? countdownTo(deadline, now) : null;
  const ask = !multi && head?.askUsd ? head.askUsd : null;
  const kind = open ? 'open' : 'fork';
  const height = Math.max(NODE_Y + 44, GHOST_Y0 + ghosts.length * GHOST_STEP + 12);

  return (
    <li
      className={`hist-row hist-row--fork${multi ? ' hist-row--multi' : ''}${reason ? ' hist-row--reason' : ''} pubws-rise`}
      data-kind={kind}
      style={{ minHeight: `${height}px` }}
    >
      <div className="hist-ghosts">
        <svg className="hist-curves" viewBox={`0 0 ${CURVES_W} ${height}`} height={height} aria-hidden="true">
          {ghosts.map((o, i) => {
            const y = GHOST_Y0 + i * GHOST_STEP;
            return (
              <g key={`${o.proposalId}-${o.label}`} className={`hist-tone--${toneOf(fork, o, open)}`}>
                <path d={`M${CURVES_W} ${NODE_Y} C${CURVES_W - 24} ${NODE_Y} 30 ${y} 6 ${y}`} />
                <circle cx="6" cy={y} r="3.5" />
              </g>
            );
          })}
        </svg>
        {ghosts.map((o, i) => {
          const price = num(o.price, unit);
          return (
            <span
              key={`${o.proposalId}-${o.label}`}
              className={`hist-ghost hist-tone--${toneOf(fork, o, open)}`}
              style={{ top: `${GHOST_Y0 + i * GHOST_STEP}px` }}
            >
              <span className="hist-ghost-label">{o.label}</span>
              {price && <b>{price}</b>}
            </span>
          );
        })}
      </div>
      <div className="hist-trunk">
        <span className={`hist-node${open ? ' hist-node--open' : ''}`} />
      </div>
      <div className="hist-body">
        <div className="hist-main">
          <div className="hist-title">
            {!multi && head?.number != null && <span className="hist-num">#{head.number}</span>}
            {head?.href ? <Link to={head.href}>{fork.title}</Link> : <span>{fork.title}</span>}
            {multi && lead && <span className="hist-answer">: {lead.label}</span>}
          </div>
          <div className="pubws-prow-meta">
            {head && (
              <span title="proposed by">
                {Icon.user}
                {head.proposedBy}
              </span>
            )}
            {ask && (
              <span title="asks">
                {Icon.usd}${ask}
              </span>
            )}
            {clock ? (
              <span className={`hist-meta-when${clock.urgent ? ' hist-tone--declined' : ''}`} title="decides">
                {Icon.clock}
                {clock.label}
              </span>
            ) : (
              <span className="hist-meta-when" title={open ? 'decides' : 'decided'}>
                {Icon.clock}
                {whenOf(fork.at)}
              </span>
            )}
            {fork.metric && (
              <span title="the number these prices are about">
                {Icon.chart}
                {metricLabelOf(fork.metric.name)} · {periodOf(fork.metric.targetDate)}
              </span>
            )}
          </div>
          {reason && <p className="pubws-reason">{reason}</p>}
        </div>
        <div className={`hist-verdict${verdictTone(fork)}`}>
          <span className="pubws-verdict">{VERDICT_WORD[fork.verdict] ?? fork.verdict}</span>
          {takenPrice && <span className="hist-price">{takenPrice}</span>}
        </div>
      </div>
    </li>
  );
}

function BookLine({ book }: { book: HistoryBook }) {
  const unit = currencyOf(book.metricName);
  const call = num(book.call, unit);
  const value = num(book.value, unit);
  return (
    <div className="hist-book">
      <span className="hist-book-name">
        {metricLabelOf(book.metricName)} <span className="hist-book-period">· {periodOf(book.targetDate)}</span>
      </span>
      <span className="hist-book-call">
        {book.voided ? (
          'voided · refunded'
        ) : (
          <>
            {call !== null && `called ${call} → `}
            settled <b>{value ?? 'no reading'}</b>
          </>
        )}
      </span>
    </div>
  );
}

function SettleRow({ settle }: { settle: HistorySettle }) {
  return (
    <li className="hist-row hist-row--settle pubws-rise" data-kind="settle">
      <div className="hist-ghosts">
        <span className="hist-when">{whenOf(settle.at)}</span>
      </div>
      <div className="hist-trunk">
        <span className="hist-node hist-node--book" />
      </div>
      <div className="hist-body">
        <div className="hist-books">
          {settle.books.map(b => (
            <BookLine key={b.marketId} book={b} />
          ))}
        </div>
      </div>
    </li>
  );
}

export function FloorHistoryPage() {
  const { slug = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [history, setHistory] = useState<FloorHistory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The replay thumb, ms; null is now. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    setState('loading');
    api
      .getFloorHistory(slug, {})
      .then(h => {
        if (!live) return;
        setHistory(h);
        setCursor(null);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('failed');
      });
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  // The tip's countdowns tick by the minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const loadOlder = useCallback(() => {
    if (!history?.next || loadingMore) return;
    setLoadingMore(true);
    api
      .getFloorHistory(slug, { before: history.next })
      .then(page => {
        setHistory(h => (h ? { ...h, events: [...h.events, ...page.events], next: page.next } : h));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [history, loadingMore, slug]);

  const nowMs = history ? Date.parse(history.now) : 0;
  const oldestMs = useMemo(() => {
    if (!history || history.events.length === 0) return nowMs;
    return Math.min(...history.events.map(e => Date.parse(e.at)));
  }, [history, nowMs]);
  const at = cursor ?? nowMs;
  const atNow = cursor === null || cursor >= nowMs;

  // Play runs the thumb from the oldest loaded event to now.
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const span = Math.max(1, nowMs - oldestMs);
    const from = cursor === null || cursor >= nowMs ? oldestMs : cursor;
    const t0 = performance.now() - ((from - oldestMs) / span) * PLAY_MS;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / PLAY_MS);
      const next = oldestMs + k * span;
      if (k >= 1) {
        setCursor(null);
        setPlaying(false);
        return;
      }
      setCursor(next);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const shownEvents = history ? history.events.filter(e => atNow || Date.parse(e.at) <= at) : [];
  const shownOpen = history && atNow ? history.open : [];
  const empty = history && history.events.length === 0 && history.open.length === 0;
  const c = history?.counts;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} busy={state === 'loading'} />
      <main className="pubws-doc hist">
        <header className="hist-head">
          <p className="pubws-h2">History</p>
          <h1 className="pubws-name hist-name">
            <Link to={`/${history?.workspace.slug ?? slug}`}>{history?.workspace.name ?? slug}</Link>
          </h1>
          {c && (
            <p className="hist-counts">
              {`${c.decided.toLocaleString('en-US')} decided · ${c.settled.toLocaleString('en-US')} ${c.settled === 1 ? 'book' : 'books'} settled · ${c.voided.toLocaleString('en-US')} voided`}
              {history?.since ? ` · since ${dayOf(history.since)}` : ''}
            </p>
          )}
        </header>

        {state === 'loading' && (
          <div className="hist-tree" aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div key={i} className="pubws-ghost" style={{ height: '3.2rem', margin: '0 0 0.8rem' }} />
            ))}
          </div>
        )}

        {state === 'failed' && (
          <p className="hist-empty">
            The history could not be loaded.
            <button type="button" className="pubws-ballot-fold-act hist-older" onClick={() => setAttempt(n => n + 1)}>
              Try again
            </button>
          </p>
        )}

        {state === 'ready' && empty && <p className="hist-empty">Nothing has been decided or settled here yet.</p>}

        {state === 'ready' && history && !empty && (
          <>
            <ol className="hist-tree" aria-label={`The history of ${history.workspace.name}`}>
              <li className="hist-line hist-now">
                <div className="hist-ghosts" />
                <div className="hist-trunk">
                  <span className="hist-node hist-node--now" />
                </div>
                <div className="hist-body">
                  <span className="hist-now-label">
                    {atNow ? `now · ${whenOf(history.now)}` : whenOf(new Date(at).toISOString())}
                  </span>
                </div>
              </li>
              {shownOpen.map(f => (
                <ForkRow key={`open-${f.proposals.map(p => p.id).join('-')}`} fork={f} open now={tick} />
              ))}
              {shownEvents.map(e =>
                e.kind === 'fork' ? (
                  <ForkRow key={`f-${e.proposals.map(p => p.id).join('-')}`} fork={e} open={false} now={tick} />
                ) : (
                  <SettleRow key={`s-${e.at}-${e.books[0]?.marketId}`} settle={e} />
                ),
              )}
              <li className="hist-line hist-root">
                <div className="hist-ghosts" />
                <div className="hist-trunk" />
                <div className="hist-body">
                  {history.next && (
                    <button type="button" className="hist-older" onClick={loadOlder} disabled={loadingMore}>
                      older
                    </button>
                  )}
                </div>
              </li>
            </ol>

            <div className="hist-replay">
              <button
                type="button"
                className="hist-play"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying(p => !p)}
              >
                {playing ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <rect x="2" y="1.5" width="3" height="9" fill="currentColor" />
                    <rect x="7" y="1.5" width="3" height="9" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="hist-scrub"
                aria-label="Replay"
                min={oldestMs}
                max={nowMs}
                step={1}
                value={at}
                onChange={e => {
                  setPlaying(false);
                  const v = Number(e.target.value);
                  setCursor(v >= nowMs ? null : v);
                }}
              />
              <span className="hist-replay-when">{atNow ? 'now' : whenOf(new Date(at).toISOString())}</span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
