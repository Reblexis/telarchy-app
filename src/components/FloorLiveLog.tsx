import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActionRow } from '../lib/api';
import { type LiveGroup, type LiveStatus, liveEntries, shortTradeText } from '../lib/live-log';
import { clockOf } from '../lib/viewer-time';

/**
 * The floor's Live column and its folded strip (docs/ui-conventions.md, "The
 * live log"; design direction A). Presentational: the rows come from
 * useWorkspaceLog on the page, shared by both, so the floor reads once.
 */

type Props = {
  slug: string;
  /** The workspace's log, newest first. */
  rows: ActionRow[];
  /** A decision window of five minutes or less: group by proposal. */
  fast: boolean;
  /** Rows that arrived after the first read, tinted until the pointer moves. */
  newIds: Set<string>;
  onSeen: () => void;
};

/** The block draws the newest this many rows it holds. */
const SHOWN = 30;

function statusText(s: LiveStatus): string {
  if (s.kind === 'open') return 'open';
  if (s.kind === 'chosen') return `chose ${s.label}`;
  return s.kind;
}

function Who({ row }: { row: ActionRow }) {
  if (!row.actor) return null;
  return (
    <>
      <b className="pubws-live-who">{row.actor.handle}</b>{' '}
    </>
  );
}

function Group({ g, newIds }: { g: LiveGroup; newIds: Set<string> }) {
  const fresh = g.rows.some(r => newIds.has(r.id));
  return (
    <div className={`pubws-live-group${fresh ? ' is-new' : ''}`}>
      <div className="pubws-live-group-head">
        <Link className="pubws-live-group-title" to={g.href} title={g.title}>
          {g.title}
        </Link>
        <span className={`pubws-live-status is-${g.status.kind}`}>{statusText(g.status)}</span>
      </div>
      {g.rows.map(row => (
        <Link key={row.id} className="pubws-live-row pubws-live-row--in" to={row.href}>
          <time className="pubws-live-time" dateTime={row.at}>
            {clockOf(row.at)}
          </time>
          <span className="pubws-live-text">
            <Who row={row} />
            {row.kind === 'trade' ? shortTradeText(row) : row.text}
          </span>
        </Link>
      ))}
      {g.openedWith !== null && (
        <span className="pubws-live-row pubws-live-row--in pubws-live-opened">
          <time className="pubws-live-time" dateTime={g.openedAt}>
            {clockOf(g.openedAt)}
          </time>
          <span className="pubws-live-text">opened with {g.openedWith.toLocaleString('en-US')} cr</span>
        </span>
      )}
    </div>
  );
}

export function LiveLogBlock({ slug, rows, fast, newIds, onSeen }: Props) {
  const entries = liveEntries(rows.slice(0, SHOWN), fast);
  return (
    <section
      className="pubws-live"
      aria-label="Live"
      aria-live="polite"
      onMouseMove={() => {
        if (newIds.size) onSeen();
      }}
    >
      <div className="pubws-live-head pubws-lb-head">
        <span className="pubws-live-title">
          <span className="pubws-live-dot" aria-hidden="true" />
          <span>Live</span>
        </span>
        <Link className="pubws-live-all" to={`/${slug}/log`}>
          All activity
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="pubws-live-empty">Nothing has happened here yet.</p>
      ) : (
        <div className="pubws-live-list">
          {entries.map(e =>
            e.type === 'group' ? (
              <Group key={`g${e.number}`} g={e} newIds={newIds} />
            ) : (
              <Link key={e.row.id} className={`pubws-live-row${newIds.has(e.row.id) ? ' is-new' : ''}`} to={e.row.href}>
                <time className="pubws-live-time" dateTime={e.row.at}>
                  {clockOf(e.row.at)}
                </time>
                <span className="pubws-live-body">
                  <span className="pubws-live-kind">{e.row.kind}</span>
                  <span className="pubws-live-text">
                    <Who row={e.row} />
                    {e.row.text}
                  </span>
                </span>
              </Link>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** Below 1500px: one line under the verbs that opens the block in place. */
export function LiveLogStrip(props: Props) {
  const [open, setOpen] = useState(false);
  const newest = props.rows[0];
  if (!newest) return null;
  return (
    <div className="pubws-live-strip">
      <button type="button" className="pubws-live-strip-line" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="pubws-live-dot" aria-hidden="true" />
        <span className="pubws-live-strip-text">
          <Who row={newest} />
          {newest.kind === 'trade' ? shortTradeText(newest) : newest.text}
        </span>
        <time className="pubws-live-time" dateTime={newest.at}>
          {clockOf(newest.at)}
        </time>
        <span className="pubws-live-chev" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && <LiveLogBlock {...props} />}
    </div>
  );
}
