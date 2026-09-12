import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { GUIDE_ALIASES, GuideIndex, OneGuide } from '../components/Guides';
import { PlannedTimeline } from '../components/PlannedTimeline';
import { useAuth } from '../hooks/useAuth';
import {
  type ActionRow,
  type ActionsPage,
  type ActionsParams,
  actionsQueryString,
  api,
  type DataRoomVision,
} from '../lib/api';
import { withBase } from '../lib/base-path';
import { TopBar } from './TradePage';

/**
 * telarchy.com/data-room: where Telarchy accounts for itself in public
 * (docs/data-room.md). Four tabs, each an address and each drawing one
 * endpoint's response and nothing else: the log (`/data-room`,
 * `GET /api/data-room/actions`, filtered through the page's own URL query),
 * what is planned (`/data-room/planned`, `GET /api/data-room/planned`),
 * documentation (`/data-room/docs`, the guides) and vision
 * (`/data-room/vision`, `GET /api/data-room/vision`). Drawn as the desk
 * (docs/ui-conventions.md, "The data room"): the site's dark tokens whatever
 * the visitor's theme, mono labels, hairlines.
 */

/** How often the log asks for rows newer than the newest it holds. */
const POLL_MS = 60_000;

const FILTER_KEYS = ['kinds', 'workspace', 'participant', 'after', 'before'] as const;

type Tab = 'log' | 'planned' | 'docs' | 'vision';

/** In the order the owner set (docs/data-room.md, the opening). */
const TABS: Array<{ id: Tab; label: string; to: string }> = [
  { id: 'log', label: 'Log', to: '/data-room' },
  { id: 'planned', label: 'What is planned', to: '/data-room/planned' },
  { id: 'docs', label: 'Documentation', to: '/data-room/docs' },
  { id: 'vision', label: 'Vision', to: '/data-room/vision' },
];

/** The tab is the address; anything under the room that is not a tab's is the log. */
function tabOf(pathname: string): Tab {
  const rest = pathname.replace(/\/+$/, '').replace(/^.*\/data-room/, '');
  if (rest.startsWith('/planned')) return 'planned';
  if (rest.startsWith('/docs')) return 'docs';
  if (rest.startsWith('/vision')) return 'vision';
  return 'log';
}

function readFilters(search: URLSearchParams): ActionsParams {
  const out: ActionsParams = {};
  for (const k of FILTER_KEYS) {
    const v = search.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** "Thursday, 10 September 2026", the day rule the rows sit under. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "09:05", UTC, the time in the row. */
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** The log tab: the stamp, the filter bar and the log (docs/data-room.md,
 *  "The page"). Mounted only while the log is the open tab, so its reads and
 *  its minute poll stop the moment the reader is elsewhere. */
/**
 * The log itself: the stamp, the filter bar, the rows, and More (docs/data-room.md,
 * "The page"). The data room's Log tab renders it for every floor; a workspace's
 * own `/<slug>/log` renders it with the workspace fixed (docs/data-room.md, "A
 * workspace's log"): no floor select, no floor name on a row.
 */
export function ActionsLog({
  onBusy,
  fixedWorkspace,
  onVocab,
}: {
  onBusy?: (busy: boolean) => void;
  fixedWorkspace?: string;
  onVocab?: (vocab: Pick<ActionsPage, 'kinds' | 'workspaces'>) => void;
}) {
  const [search, setSearch] = useSearchParams();
  const filters = useMemo(
    () => (fixedWorkspace ? { ...readFilters(search), workspace: fixedWorkspace } : readFilters(search)),
    [search, fixedWorkspace],
  );
  const filterKey = actionsQueryString(filters);

  const [vocab, setVocab] = useState<Pick<ActionsPage, 'kinds' | 'workspaces'> | null>(null);
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const rowsRef = useRef<ActionRow[]>([]);
  rowsRef.current = rows;

  // The first page, whenever the filters change. A request that is no
  // longer the newest one is dropped rather than raced onto the page.
  useEffect(() => {
    let live = true;
    setState('loading');
    setNewIds(new Set());
    api
      .getActions(filters)
      .then(page => {
        if (!live) return;
        setVocab({ kinds: page.kinds, workspaces: page.workspaces });
        onVocab?.({ kinds: page.kinds, workspaces: page.workspaces });
        setRows(page.rows);
        setNext(page.next);
        setGeneratedAt(page.generatedAt);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('failed');
      });
    return () => {
      live = false;
    };
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // New rows on their own, each minute, with the same filters: rows after
  // the newest one on the page, prepended and marked until the pointer moves.
  useEffect(() => {
    if (state !== 'ready') return;
    const id = window.setInterval(() => {
      const newest = rowsRef.current[0]?.at;
      if (!newest) return;
      api
        .getActions({ ...filters, after: newest })
        .then(page => {
          if (!page.rows.length) return;
          const have = new Set(rowsRef.current.map(r => r.id));
          const fresh = page.rows.filter(r => !have.has(r.id));
          if (!fresh.length) return;
          setRows(prev => [...fresh, ...prev]);
          setNewIds(prev => new Set([...prev, ...fresh.map(r => r.id)]));
          setGeneratedAt(page.generatedAt);
        })
        .catch(() => {
          /* the next tick tries again; a missed poll is not a failed page */
        });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [state, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    api
      .getActions({ ...filters, cursor: next })
      .then(page => {
        const have = new Set(rowsRef.current.map(r => r.id));
        setRows(prev => [...prev, ...page.rows.filter(r => !have.has(r.id))]);
        setNext(page.next);
      })
      .catch(() => {
        /* the button stays; the reader can try again */
      })
      .finally(() => setLoadingMore(false));
  }, [next, loadingMore, filters]);

  // The More button fires on its own when it scrolls into view.
  const moreRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, next]);

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string | null) => {
    const q = new URLSearchParams(search);
    if (value) q.set(key, value);
    else q.delete(key);
    setSearch(q);
  };

  const activeKinds = useMemo(() => new Set((filters.kinds ?? '').split(',').filter(Boolean)), [filters.kinds]);
  const toggleKind = (id: string) => {
    const nextKinds = new Set(activeKinds);
    if (nextKinds.has(id)) nextKinds.delete(id);
    else nextKinds.add(id);
    // Keep the vocabulary's order so two readers with the same kinds get the
    // same URL.
    const ordered = (vocab?.kinds ?? []).map(k => k.id).filter(k => nextKinds.has(k));
    setFilter('kinds', ordered.length ? ordered.join(',') : null);
  };

  const days = useMemo(() => {
    const out: Array<{ day: string; rows: ActionRow[] }> = [];
    for (const r of rows) {
      const key = dayKey(r.at);
      const last = out[out.length - 1];
      if (last && last.day === key) last.rows.push(r);
      else out.push({ day: key, rows: [r] });
    }
    return out;
  }, [rows]);

  const kindLabel = (id: string) => vocab?.kinds.find(k => k.id === id)?.label ?? id;
  const anyFilter = FILTER_KEYS.some(k => filters[k] && !(fixedWorkspace && k === 'workspace'));
  const jsonHref = withBase(`/api/data-room/actions${filterKey}`);

  useEffect(() => {
    onBusy?.(state === 'loading');
  }, [state, onBusy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);

  return (
    <>
      <p className="dr-stamp">
        <span className="dr-live">
          <span className="dr-live-dot" aria-hidden="true" />
          read live, polls each minute
        </span>
        {generatedAt && (
          <span>
            rows generated{' '}
            {new Date(generatedAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'UTC',
            })}
            {' UTC'}
          </span>
        )}
        <span>times are UTC</span>
        <a href={jsonHref} className="dr-stamp-link">
          the same log as JSON
        </a>
      </p>

      <div className="dr-filters" role="group" aria-label="Filter the log">
        <div className="dr-kinds">
          {(vocab?.kinds ?? []).map(k => (
            <button
              key={k.id}
              type="button"
              className={`dr-chip dr-chip--${k.id}${activeKinds.has(k.id) ? ' is-on' : ''}`}
              aria-pressed={activeKinds.has(k.id)}
              title={k.description}
              onClick={() => toggleKind(k.id)}
            >
              <span className="dr-kind-dot" aria-hidden="true" />
              {k.label}
            </button>
          ))}
        </div>
        <div className="dr-filters-right">
          {!fixedWorkspace && (
            <label className="dr-select-wrap">
              <span className="dr-select-label">Floor</span>
              <select
                className="dr-select"
                aria-label="Floor"
                value={filters.workspace ?? ''}
                onChange={e => setFilter('workspace', e.target.value || null)}
              >
                <option value="">Every floor</option>
                {(vocab?.workspaces ?? []).map(w => (
                  <option key={w.slug} value={w.slug}>
                    {w.hidden ? `${w.name} (hidden by default)` : w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {filters.participant && (
            <button
              type="button"
              className="dr-chip dr-chip--who is-on"
              aria-pressed="true"
              title="Clear the participant filter"
              onClick={() => setFilter('participant', null)}
            >
              {filters.participant}
              <span className="dr-chip-x" aria-hidden="true">
                ×
              </span>
            </button>
          )}
          {anyFilter && (
            <button type="button" className="dr-clear" onClick={() => setSearch(new URLSearchParams())}>
              Clear
            </button>
          )}
        </div>
      </div>

      <section className="dr-log" aria-live="polite" onMouseMove={() => newIds.size && setNewIds(new Set())}>
        {state === 'failed' && <p className="dr-err">The log would not open.</p>}
        {state === 'ready' && rows.length === 0 && <p className="dr-empty">No actions match.</p>}
        {days.map(d => (
          <div className="dr-day" key={d.day}>
            <h2 className="dr-day-rule">{dayLabel(d.rows[0].at)}</h2>
            <ol className="dr-rows">
              {d.rows.map(r => (
                <li key={r.id} className={`dr-row dr-row--${r.kind}${newIds.has(r.id) ? ' is-new' : ''}`}>
                  <time className="dr-row-time" dateTime={r.at} title={r.at}>
                    {timeLabel(r.at)}
                  </time>
                  <span className="dr-row-kind" title={kindLabel(r.kind)}>
                    <span className="dr-kind-dot" aria-hidden="true" />
                    <span className="dr-row-kind-label">{kindLabel(r.kind)}</span>
                  </span>
                  <span className="dr-row-body">
                    {r.actor && (
                      <button
                        type="button"
                        className="dr-row-who"
                        title={`Only ${r.actor.handle}`}
                        onClick={() => setFilter('participant', r.actor!.handle)}
                      >
                        {r.actor.handle}
                      </button>
                    )}
                    <Link className="dr-row-text" to={r.href}>
                      {r.text}
                    </Link>
                  </span>
                  {r.workspace && !fixedWorkspace && (
                    <button
                      type="button"
                      className="dr-row-floor"
                      title={`Only ${r.workspace.name}`}
                      onClick={() => setFilter('workspace', r.workspace!.slug)}
                    >
                      {r.workspace.name}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      {state === 'ready' && rows.length > 0 && (
        <footer className="dr-foot">
          {next ? (
            <button type="button" className="dr-more" ref={moreRef} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading' : 'More'}
            </button>
          ) : (
            <span className="dr-end">End of the log.</span>
          )}
        </footer>
      )}
    </>
  );
}

function LogTab({ onBusy }: { onBusy: (busy: boolean) => void }) {
  return <ActionsLog onBusy={onBusy} />;
}

/** Documentation: the guides, rendered by the same components as /guides,
 *  inside the room (docs/data-room.md, "Documentation"). */
function DocsTab({ section }: { section?: string }) {
  if (section && GUIDE_ALIASES[section]) return <Navigate to={`/data-room/docs/${GUIDE_ALIASES[section]}`} replace />;
  return (
    <div className="dr-docs">
      {section ? (
        <OneGuide section={section} base="/data-room/docs" inRoom />
      ) : (
        <GuideIndex base="/data-room/docs" inRoom />
      )}
    </div>
  );
}

/** Vision: one markdown document, rendered with the stack announcements use
 *  (docs/data-room.md, "Vision"). */
function VisionTab() {
  const [vision, setVision] = useState<DataRoomVision | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getDataRoomVision()
      .then(v => {
        if (live) setVision(v);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="dr-vision" aria-label="Vision">
      {failed && <p className="dr-err">The vision would not open.</p>}
      {vision && (
        <>
          <div className="dr-tl-head">
            <h2 className="dr-tl-label">{vision.title}</h2>
            <span className="dr-vision-updated">updated {vision.updatedAt}</span>
          </div>
          <div className="pubws-ann-body dr-vision-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {vision.markdown}
            </ReactMarkdown>
          </div>
        </>
      )}
    </section>
  );
}

export function DataRoomPage() {
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const { section } = useParams<{ section?: string }>();
  const tab = tabOf(pathname);
  const [busy, setBusy] = useState(false);

  return (
    <div className="pubws dr-desk" data-theme="dark">
      <TopBar user={!!user} ready={!authLoading} busy={busy} />
      <main className="dr">
        <header className="dr-head">
          <div className="dr-head-main">
            <h1 className="dr-title">Data room</h1>
            <p className="dr-lead">
              Where Telarchy accounts for itself in public: what happened, what is planned, how it works and where it is
              going.
            </p>
          </div>
        </header>

        <nav className="dr-tabs" aria-label="Data room">
          {TABS.map(t => (
            <Link
              key={t.id}
              to={t.to}
              className={`dr-tab${tab === t.id ? ' is-current' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab === 'log' && <LogTab onBusy={setBusy} />}
        {tab === 'planned' && <PlannedTimeline />}
        {tab === 'docs' && <DocsTab section={section} />}
        {tab === 'vision' && <VisionTab />}
      </main>
    </div>
  );
}
