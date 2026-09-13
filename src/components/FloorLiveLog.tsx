import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActionRow } from '../lib/api';
import { type LiveEntry, type LiveGroup, type LiveStatus, liveEntries, shortTradeText } from '../lib/live-log';
import { clockOf } from '../lib/viewer-time';

/**
 * The floor's Live column and its folded strip (docs/ui-conventions.md, "The
 * live log"; design direction A, and its compact block with the fold). Presentational: the rows come from
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

type BlockProps = Props & {
  /** Open compact whatever the floor's remembered fold: the strip's block,
   *  which the visitor has just asked to see. */
  opensCompact?: boolean;
};

/** The block holds the newest this many rows; "Show more" opens up to them. */
const SHOWN = 30;
/** A slow floor, or a fast one with no proposal in the window, opens on this many. */
const COMPACT = 5;

/** How many lines an entry draws: a group's rows and its "opened with" line
 *  (at least one, its head), a standing row one. */
function linesOf(e: LiveEntry): number {
  if (e.type === 'row') return 1;
  return Math.max(1, e.rows.length + (e.openedWith !== null ? 1 : 0));
}

/** How many entries the compact block draws: through the newest proposal's
 *  group on a fast floor, otherwise the newest five. */
function compactCount(entries: LiveEntry[], fast: boolean): number {
  if (fast) {
    const newestGroup = entries.findIndex(e => e.type === 'group');
    if (newestGroup >= 0) return newestGroup + 1;
  }
  return Math.min(entries.length, COMPACT);
}

/** The fold is remembered per visitor and per floor; a storage the browser
 *  refuses means "not folded", never a broken block. */
const foldKey = (slug: string) => `telarchy.liveLog.folded.${slug}`;

function readFolded(slug: string): boolean {
  try {
    return localStorage.getItem(foldKey(slug)) === '1';
  } catch {
    return false;
  }
}

function writeFolded(slug: string, folded: boolean) {
  try {
    if (folded) localStorage.setItem(foldKey(slug), '1');
    else localStorage.removeItem(foldKey(slug));
  } catch {
    // Blocked storage: the fold lasts for this visit only.
  }
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      className="pubws-live-chevron"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={up ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

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

export function LiveLogBlock({ slug, rows, fast, newIds, onSeen, opensCompact = false }: BlockProps) {
  const [folded, setFolded] = useState(() => !opensCompact && readFolded(slug));
  const [more, setMore] = useState(false);
  // Another floor in the same mount reads its own fold and opens compact.
  useEffect(() => {
    setFolded(!opensCompact && readFolded(slug));
    setMore(false);
  }, [slug, opensCompact]);

  const entries = liveEntries(rows.slice(0, SHOWN), fast);
  const compact = compactCount(entries, fast);
  const hidden = entries.slice(compact).reduce((n, e) => n + linesOf(e), 0);
  const shown = more ? entries : entries.slice(0, compact);
  const newest = rows[0];

  const toggleFold = () => {
    const next = !folded;
    setFolded(next);
    setMore(false);
    writeFolded(slug, next);
  };

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
        <span className="pubws-live-acts">
          {folded && newest && (
            <time className="pubws-live-time" dateTime={newest.at}>
              {clockOf(newest.at)}
            </time>
          )}
          <Link className="pubws-live-all" to={`/${slug}/log`}>
            All activity
            <span aria-hidden="true"> →</span>
          </Link>
          <button
            type="button"
            className="pubws-live-fold"
            aria-expanded={!folded}
            aria-label={folded ? 'Open the live log' : 'Fold the live log'}
            onClick={toggleFold}
          >
            <Chevron up={!folded} />
          </button>
        </span>
      </div>
      {folded ? null : rows.length === 0 ? (
        <p className="pubws-live-empty">Nothing has happened here yet.</p>
      ) : (
        <>
          <div className="pubws-live-list">
            {shown.map(e =>
              e.type === 'group' ? (
                <Group key={`g${e.number}`} g={e} newIds={newIds} />
              ) : (
                <Link
                  key={e.row.id}
                  className={`pubws-live-row${newIds.has(e.row.id) ? ' is-new' : ''}`}
                  to={e.row.href}
                >
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
          {hidden > 0 && (
            <button type="button" className="pubws-live-more" aria-expanded={more} onClick={() => setMore(m => !m)}>
              <span>{more ? 'Show fewer' : `Show ${hidden} more`}</span>
              <Chevron up={more} />
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Below 1500px: one line directly under the bet verbs in the centre column,
 * never in the ticket column, that opens the block in place. It starts with
 * the Live label in the block head's anatomy so it never reads as a picker.
 */
export function LiveLogStrip(props: Props) {
  const [open, setOpen] = useState(false);
  const newest = props.rows[0];
  if (!newest) return null;
  return (
    <div className="pubws-live-strip">
      <button type="button" className="pubws-live-strip-line" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="pubws-live-title">
          <span className="pubws-live-dot" aria-hidden="true" />
          <span>Live</span>
        </span>
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
      {open && <LiveLogBlock {...props} opensCompact />}
    </div>
  );
}
