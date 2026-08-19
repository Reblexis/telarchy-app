import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type NotificationItem } from '../lib/api';

/**
 * The floor's inbox (owner ask 2026-08-19): one bell in the top bar that
 * answers "what happened while I was away".
 *
 * It shows EVERYTHING, deliberately: comments on your contracts, replies in
 * threads you are in, new contracts where you trade, and decisions on your
 * own contracts, whether or not the matching email is switched on. The
 * switches tune interruption; this is the record.
 *
 * The count is set in the floor's own instrument type (mono, amber), the
 * same face every price on the page uses, because a number a trader can
 * read at a glance is this page's whole idiom. Unread rows carry an amber
 * hairline down their left edge and lose it once read: no dots, no badges
 * inside the list, one signal doing one job.
 */

const KIND_VERB: Record<NotificationItem['kind'], string> = {
  comment: 'commented on your contract',
  reply: 'replied in a thread you are in',
  contract: 'put a contract on the ballot',
  decision: 'was decided',
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'now';
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Where a row goes: the floor, and the contract when there is one. */
function hrefFor(n: NotificationItem): string | null {
  if (!n.workspaceSlug) return null;
  return n.proposalId
    ? `/${n.workspaceSlug}#contract=${encodeURIComponent(n.proposalId)}`
    : `/${n.workspaceSlug}`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    api.getNotifications()
      .then(p => { setItems(p.notifications); setUnread(p.unread); })
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
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

  const markRead = async () => {
    // Optimistic: the count is the only thing that changes, and the rows
    // stay exactly where they are so nothing moves under the cursor.
    setUnread(0);
    setItems(list => list?.map(n => ({ ...n, unread: false })) ?? list);
    await api.markNotificationsSeen().catch(e => console.error('mark seen failed:', e));
  };

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className={`notif-trigger${unread > 0 ? ' has-unread' : ''}`}
        aria-label={unread > 0 ? `What's new, ${unread} unread` : "What's new"}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg className="notif-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
              <button type="button" className="notif-mark" onClick={() => void markRead()}>
                Mark all read
              </button>
            )}
          </div>

          {items === null ? (
            <p className="notif-empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="notif-empty">
              Nothing yet. Comments on your contracts, answers in your threads, and new
              contracts where you trade land here.
            </p>
          ) : (
            <ul className="notif-list">
              {items.map(n => {
                const href = hrefFor(n);
                const body = (
                  <>
                    <span className="notif-row-top">
                      <span className={`notif-kind notif-kind--${n.kind}`}>
                        {n.actor ? `${n.actor} ${KIND_VERB[n.kind]}` : `Your contract ${KIND_VERB[n.kind]}`}
                      </span>
                      <span className="notif-time">{timeAgo(n.at)}</span>
                    </span>
                    <span className="notif-subject">{n.subject}</span>
                    {n.detail && <span className="notif-detail">{n.detail}</span>}
                  </>
                );
                return (
                  <li key={n.id} className={`notif-row${n.unread ? ' is-unread' : ''}`}>
                    {href
                      ? <a className="notif-row-link" href={href}>{body}</a>
                      : <span className="notif-row-link">{body}</span>}
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
