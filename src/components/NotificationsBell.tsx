import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type NotificationItem } from '../lib/api';

/**
 * The floor's inbox (owner ask 2026-08-19): one bell in the top bar that
 * answers "what happened while I was away".
 *
 * It shows EVERYTHING, deliberately: comments on your proposals, replies in
 * threads you are in, new proposals where you trade, and decisions on your
 * own proposals, whether or not the matching email is switched on. The
 * switches tune interruption; this is the record.
 *
 * The count is set in the floor's own instrument type (mono, amber), the
 * same face every price on the page uses, because a number a trader can
 * read at a glance is this page's whole idiom. With news the whole trigger
 * lights: the icon takes the accent, the count becomes a filled amber chip,
 * and a fresh arrival pulses once (owner ask 2026-08-19: it was too quiet to
 * notice). Unread rows carry an amber hairline down their left edge and lose
 * it the moment they are opened: no dots, no badges inside the list, one
 * signal doing one job.
 *
 * Opening a row reads THAT row (owner ask, same day: "one less per click").
 * The whole-list "Mark all read" stays for the sweep.
 */

const KIND_VERB: Record<NotificationItem['kind'], string> = {
  comment: 'commented on your proposal',
  reply: 'replied in a thread you are in',
  contract: 'put a proposal on the ballot',
  anyComment: 'commented',
  settled: 'settled',
  decision: 'was decided',
  stale: 'is about to settle on an old number',
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'now';
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * Where a row goes: the floor, the proposal when there is one, and the
 * comment itself when the row is about a comment. The floor reads these off
 * the hash, opens the thread and flashes the line, so a row lands on the
 * thing it named rather than near it.
 */
function hrefFor(n: NotificationItem): string | null {
  if (!n.workspaceSlug) return null;
  const parts: string[] = [];
  if (n.proposalId) parts.push(`proposal=${encodeURIComponent(n.proposalId)}`);
  if (n.commentId) parts.push(`comment=${encodeURIComponent(n.commentId)}`);
  return parts.length > 0 ? `/${n.workspaceSlug}#${parts.join('&')}` : `/${n.workspaceSlug}`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [arrived, setArrived] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const lastUnread = useRef(0);

  const load = useCallback(() => {
    api
      .getNotifications()
      .then(p => {
        setItems(p.notifications);
        setUnread(p.unread);
        // Pulse only on a RISE. Pulsing on every poll would be a page that
        // twitches at rest, which is how people learn to ignore a signal.
        if (p.unread > lastUnread.current) {
          setArrived(true);
          setTimeout(() => setArrived(false), 1400);
        }
        lastUnread.current = p.unread;
      })
      .catch(e => console.error('notifications fetch failed:', e));
  }, []);

  useEffect(load, [load]);
  // Slow poll: this is news, not a feed, and the page it sits on is a
  // trading floor that should not be spending requests on a bell.
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const markAllRead = async () => {
    // Optimistic: the count is the only thing that changes, and the rows
    // stay exactly where they are so nothing moves under the cursor.
    setUnread(0);
    lastUnread.current = 0;
    setItems(list => list?.map(n => ({ ...n, unread: false })) ?? list);
    await api.markNotificationsSeen().catch(e => console.error('mark seen failed:', e));
  };

  /**
   * Opening a row: take one off the count, drop that row's mark, then go.
   * Navigation is router-side rather than a document load, so the read
   * request is not cancelled by the page it just opened.
   */
  const openRow = (n: NotificationItem, href: string | null) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (n.unread) {
      setUnread(u => Math.max(0, u - 1));
      lastUnread.current = Math.max(0, lastUnread.current - 1);
      setItems(list => list?.map(x => (x.id === n.id ? { ...x, unread: false } : x)) ?? list);
      void api.markNotificationRead(n.id).catch(err => console.error('mark read failed:', err));
    }
    if (href) {
      setOpen(false);
      navigate(href);
    }
  };

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className={`notif-trigger${unread > 0 ? ' has-unread' : ''}${arrived ? ' just-arrived' : ''}`}
        aria-label={unread > 0 ? `What's new, ${unread} unread` : "What's new"}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg
          className="notif-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
          <path d="M10.5 19a2 2 0 0 0 3 0" />
        </svg>
        {unread > 0 && <span className="notif-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="What's new">
          <div className="notif-panel-head">
            <span className="notif-panel-title">What&rsquo;s new</span>
            {unread > 0 && (
              <button type="button" className="notif-mark" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>

          {items === null ? (
            <p className="notif-empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="notif-empty">
              Nothing yet. Comments on your proposals, answers in your threads, and new proposals where you trade land
              here.
            </p>
          ) : (
            <ul className="notif-list">
              {items.map(n => {
                const href = hrefFor(n);
                const body = (
                  <>
                    <span className="notif-row-top">
                      <span className={`notif-kind notif-kind--${n.kind}`}>
                        {/* No actor means the system did it: a settlement, or
                            a decision. Which noun leads depends on the kind;
                            "Your proposal" was wrong the moment decisions on
                            OTHER people's proposals started landing here. */}
                        {n.actor
                          ? `${n.actor} ${KIND_VERB[n.kind]}`
                          : n.kind === 'settled'
                            ? 'A market you traded settled'
                            : n.kind === 'stale'
                              ? // Not a proposal, and nobody did it: it is the
                                // owner's own market about to settle on a
                                // number nobody has taken (2026-09-01, it read
                                // "A proposal undefined").
                                'Your market needs its number'
                              : `A proposal ${KIND_VERB[n.kind]}`}
                      </span>
                      <span className="notif-time">{timeAgo(n.at)}</span>
                    </span>
                    <span className="notif-subject">{n.subject}</span>
                    {n.detail && <span className="notif-detail">{n.detail}</span>}
                  </>
                );
                return (
                  <li key={n.id} className={`notif-row${n.unread ? ' is-unread' : ''}`}>
                    {href ? (
                      <a className="notif-row-link" href={href} onClick={openRow(n, href)}>
                        {body}
                      </a>
                    ) : (
                      <button type="button" className="notif-row-link" onClick={openRow(n, null)}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
