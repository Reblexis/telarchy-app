import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlannedTimeline } from '../components/PlannedTimeline';
import { useAuth } from '../hooks/useAuth';
import { type ActionRow, type ActionsPage, type ActionsParams, actionsQueryString, api } from '../lib/api';
import { withBase } from '../lib/base-path';
import { TopBar } from './TradePage';

/**
 * telarchy.com/data-room: the public actions log (docs/data-room.md).
 *
 * The page renders `GET /api/data-room/actions`, with the filters it holds
 * in its own URL query, so what a person is looking at is one URL swap away
 * from what an agent reads; and, between the stamp and the filter bar, "What
 * is planned" from `GET /api/data-room/planned` (the platform floor's
 * calendar, docs/data-room.md, "What is planned"). Drawn as the desk
 * (docs/ui-conventions.md, "The data room"): the site's dark tokens whatever
 * the visitor's theme, mono labels, hairlines.
 */

/** How often the page asks for rows newer than the newest it holds. */
const POLL_MS = 60_000;

const FILTER_KEYS = ['kinds', 'workspace', 'participant', 'after', 'before'] as const;

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

export function DataRoomPage() {
  const { user, loading: authLoading } = useAuth();
  const [search, setSearch] = useSearchParams();
  const filters = useMemo(() => readFilters(search), [search]);
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

  // Whose calendar "What is planned" is, as the endpoint named it, and
  // whether the reader manages that floor. The question is asked once the
  // floor is known and only of someone signed in: a visitor is a reader.
  const [plannedWs, setPlannedWs] = useState<{ id: string } | null>(null);
  const [canManagePlanned, setCanManagePlanned] = useState(false);
  useEffect(() => {
    if (!user || !plannedWs) {
      setCanManagePlanned(false);
      return;
    }
    let live = true;
    api
      .getProfile(plannedWs.id)
      .then(p => {
        if (!live) return;
        setCanManagePlanned(((p as { capabilities?: string[] }).capabilities ?? []).includes('manage'));
      })
      .catch(() => {
        if (live) setCanManagePlanned(false);
      });
    return () => {
      live = false;
    };
  }, [user, plannedWs]);

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
  const anyFilter = FILTER_KEYS.some(k => filters[k]);
  const jsonHref = withBase(`/api/data-room/actions${filterKey}`);

  return (
    <div className="pubws dr-desk" data-theme="dark">
      <TopBar user={!!user} ready={!authLoading} busy={state === 'loading'} />
      <main className="dr">
        <header className="dr-head">
          <div className="dr-head-main">
            <h1 className="dr-title">Data room</h1>
            <p className="dr-lead">Every public action on Telarchy, newest first. Times are UTC.</p>
          </div>
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
            <a href={jsonHref} className="dr-stamp-link">
              the same log as JSON
            </a>
          </p>
        </header>

        <PlannedTimeline
          canManage={canManagePlanned}
          workspaceId={plannedWs?.id ?? null}
          onWorkspace={ws => setPlannedWs(cur => (cur?.id === ws?.id ? cur : ws ? { id: ws.id } : null))}
        />

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
                    {r.workspace && (
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
      </main>
    </div>
  );
}
