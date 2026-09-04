import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * The panel under the one market view (owner ask 2026-08-11): three
 * toggles side by side, Discussion (labeled Comments until the owner's
 * 2026-08-24 rename), Positions, and Trades, each expanding in place.
 * Discussion is the conversation (post if signed in). Positions
 * shows who holds what in the market on screen; Trades shows its history.
 * All three read publicly on Open workspaces; posting a comment needs a
 * signed-in trader.
 *
 * The subject follows the page, and its two halves are addressed
 * separately on purpose: `proposalId` routes the CONVERSATION, which
 * belongs to the proposal and survives switching branch, while the market
 * ids route POSITIONS AND TRADES. A caller that passes only the proposal
 * gets comments and no activity at all (the tabs hide themselves), which
 * is how a proposal with a real trade in it rendered as "Comments (0)"
 * and nothing else.
 *
 * A proposal passes BOTH branch markets, labeled, and the tabs show their
 * union (owner report 2026-08-21: "why dont i see any trades made on the
 * conditional markets"). Scoping activity to the branch on screen was the
 * same bug in a subtler coat: a proposal opens on "if approved", so a
 * proposal whose trades all sat on the declined branch answered
 * "Trades (0)" until the reader happened to flip the toggle.
 */

interface Comment {
  id: string;
  fromName: string;
  content: string;
  createdAt: string;
}
interface Holder {
  handle: string;
  id: string;
  direction: 'higher' | 'lower';
  shares: number;
  cost: number;
  worth: number | null;
  branch?: BranchLabel;
}
interface TradeItem {
  id: string;
  handle: string;
  direction: 'higher' | 'lower';
  kind: 'buy' | 'sell';
  shares: number;
  cost: number;
  createdAt: string;
  branch?: BranchLabel;
}

/**
 * A market's pool moving: opened with, or deepened by. It sits in the same
 * list as the trades because it is the other half of every price in it
 * (owner ask 2026-08-31): a price that barely moved because the book got four
 * times deeper is not the same event as a price nobody traded.
 */
interface PoolItem {
  id: string;
  /** Null on the platform's own initial liquidity, which has no funder. */
  handle: string | null;
  kind: 'opened' | 'deepened';
  amount: number;
  /** Credits in the pool after it. */
  pool: number;
  createdAt: string;
  branch?: BranchLabel;
}

type BranchLabel = 'approved' | 'declined';

interface Props {
  idOrSlug: string;
  /** The market(s) drive positions/trades; proposalId routes the comment
   *  thread. A proposal passes `markets` with both labeled branches and the
   *  tabs show their union; a baseline market passes `marketId` alone. */
  subject: { marketId?: string; proposalId?: string; markets?: Array<{ marketId: string; branch: BranchLabel }> };
  canPost: boolean;
  onRequireSignup: () => void;
  /**
   * A comment to point at, from a notification link. The panel opens on the
   * thread, scrolls that line into view and flashes it once. Cleared through
   * onFocusHandled so the flash is an arrival, not a state the row sits in.
   */
  focusCommentId?: string | null;
  /**
   * A trade to point at, from a profile link (docs/ui-conventions.md, "A
   * trade has an address"). Same arrival as a comment: the Activity tab
   * opens, the row scrolls into view and flashes once. A trade no longer in
   * the list is handled, not waited on.
   */
  focusTradeId?: string | null;
  onFocusHandled?: () => void;
  /** Rendered at the right end of the tabs row: the market's facts. */
  trailing?: ReactNode;
}

type Tab = 'comments' | 'positions' | 'activity' | null;

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function fmtShares(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}
function fmtCr(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

function profileHref(handle: string, id: string): string {
  return `/participants/${encodeURIComponent(handle && handle !== id ? handle : id)}`;
}

export function FloorComments({
  idOrSlug,
  subject,
  canPost,
  onRequireSignup,
  focusCommentId = null,
  focusTradeId = null,
  onFocusHandled,
  trailing,
}: Props) {
  const [tab, setTab] = useState<Tab>(null);
  const activityReqRef = useRef(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const activityRef = useRef<HTMLUListElement | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [activity, setActivity] = useState<{ positions: Holder[]; trades: TradeItem[]; pool: PoolItem[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every market whose activity belongs on the tabs: both labeled branches
  // of a proposal, or the one baseline market. The key is order-stable so a
  // branch switch (which reorders nothing here) does not refetch.
  const activityMarkets: Array<{ marketId: string; branch?: BranchLabel }> = subject.markets?.length
    ? subject.markets
    : subject.marketId
      ? [{ marketId: subject.marketId }]
      : [];
  const marketKey = activityMarkets.map(m => m.marketId).join(',');
  const threadKey = subject.proposalId ?? subject.marketId ?? subject.markets?.[0]?.marketId ?? '';

  // Comments load on subject change (the count shows in the toggle).
  useEffect(() => {
    if (!threadKey) return;
    setComments(null);
    api
      .getFloorComments(idOrSlug, subject)
      .then(setComments)
      .catch(e => {
        console.error('comments fetch failed:', e);
        setComments([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrSlug, threadKey]);

  // Positions/trades load on subject change too, so counts are ready. One
  // fetch per market, merged: a proposal's two branches answer together,
  // trades newest-first across both. A branch whose fetch fails contributes
  // nothing rather than sinking the other's rows.
  useEffect(() => {
    if (!marketKey) {
      setActivity(null);
      return;
    }
    setActivity(null);
    // Only the newest pull may write: a slow response for the previous
    // subject landing late would otherwise paint the wrong market's rows.
    const token = ++activityReqRef.current;
    const wanted = activityMarkets;
    Promise.all(
      wanted.map(m =>
        api
          .getMarketActivity(idOrSlug, m.marketId)
          .then(a => ({
            positions: (a.positions ?? []).map(p => ({ ...p, branch: m.branch })),
            trades: (a.trades ?? []).map(t => ({ ...t, branch: m.branch })),
            pool: (a.pool ?? []).map(l => ({ ...l, branch: m.branch })),
          }))
          .catch(e => {
            console.error('market activity fetch failed:', e);
            return { positions: [], trades: [], pool: [] };
          }),
      ),
    ).then(parts => {
      if (token !== activityReqRef.current) return;
      setActivity({
        positions: parts.flatMap(p => p.positions),
        trades: parts
          .flatMap(p => p.trades)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        pool: parts
          .flatMap(p => p.pool)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrSlug, marketKey]);

  // A pointed-at comment opens the thread even if the panel was collapsed:
  // the reader was told about a line, not about a tab.
  useEffect(() => {
    if (focusCommentId) setTab('comments');
  }, [focusCommentId]);

  // ...and once the thread has rendered, the line is scrolled to and flashed.
  // Runs after comments load, because the row does not exist before that.
  useEffect(() => {
    if (!focusCommentId || comments === null) return;
    const el = listRef.current?.querySelector(`[data-comment-id="${CSS.escape(focusCommentId)}"]`);
    if (el) {
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      setFlashId(focusCommentId);
      setTimeout(() => setFlashId(null), 1800);
    }
    // Handled either way: a comment that has since been removed should not
    // leave the panel waiting for a row that will never arrive.
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCommentId, comments]);

  // A pointed-at trade opens Activity the same way, and flashes its row once
  // the list has rendered. Handled either way: the list holds the newest
  // rows only, and a trade that has scrolled out of it still landed the
  // reader on the right market.
  useEffect(() => {
    if (focusTradeId) setTab('activity');
  }, [focusTradeId]);
  useEffect(() => {
    if (!focusTradeId || activity === null) return;
    const el = activityRef.current?.querySelector(`[data-trade-id="${CSS.escape(focusTradeId)}"]`);
    if (el) {
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
      setFlashId(focusTradeId);
      setTimeout(() => setFlashId(null), 1800);
    }
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTradeId, activity]);

  const post = async () => {
    const content = draft.trim();
    if (!content) return;
    setError('');
    setBusy(true);
    try {
      if (subject.proposalId) await api.sendProposalMessage(subject.proposalId, content);
      else if (subject.marketId) await api.sendMarketMessage(subject.marketId, content);
      setDraft('');
      setComments(await api.getFloorComments(idOrSlug, subject));
    } catch (e) {
      setError((e as Error).message || 'Could not post that');
    } finally {
      setBusy(false);
    }
  };

  if (!threadKey) return null;
  const toggle = (t: Tab) => setTab(cur => (cur === t ? null : t));
  const cCount = comments?.length ?? null;
  // Optional all the way down: a market-activity payload that arrives
  // without its lists (an older deploy, a 404 body, an empty stub) must not
  // take the whole floor down with a TypeError while rendering a counter.
  const pCount = activity?.positions?.length ?? null;
  // One list, so one count: a reader who counts the rows should find the
  // number on the tab (owner ask 2026-08-31, "name activity").
  const aCount = activity ? activity.trades.length + activity.pool.length : null;
  // Newest first, both kinds in the same order, because the order is the
  // point: the injection above a trade is why that trade moved the price less
  // than the one below it.
  const merged: Array<({ row: 'trade' } & TradeItem) | ({ row: 'pool' } & PoolItem)> = activity
    ? [
        ...activity.trades.map(t => ({ row: 'trade' as const, ...t })),
        ...activity.pool.map(l => ({ row: 'pool' as const, ...l })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  return (
    <div className="pubws-comments">
      <div className="pubws-panel-tabs">
        <button
          className={`pubws-comments-toggle${tab === 'comments' ? ' is-active' : ''}`}
          aria-expanded={tab === 'comments'}
          onClick={() => toggle('comments')}
        >
          Discussion{cCount !== null ? ` (${cCount})` : ''}
        </button>
        {marketKey && (
          <>
            <button
              className={`pubws-comments-toggle${tab === 'positions' ? ' is-active' : ''}`}
              aria-expanded={tab === 'positions'}
              onClick={() => toggle('positions')}
            >
              Positions{pCount !== null ? ` (${pCount})` : ''}
            </button>
            <button
              className={`pubws-comments-toggle${tab === 'activity' ? ' is-active' : ''}`}
              aria-expanded={tab === 'activity'}
              onClick={() => toggle('activity')}
            >
              Activity{aCount !== null ? ` (${aCount})` : ''}
            </button>
          </>
        )}
        {trailing}
      </div>

      {tab === 'comments' && (
        <div className="pubws-comments-body">
          {comments === null ? (
            <p className="pubws-comments-empty">…</p>
          ) : comments.length === 0 ? (
            <p className="pubws-comments-empty">Nothing yet. Say what you see.</p>
          ) : (
            <ul className="pubws-comments-list" ref={listRef}>
              {comments.map(c => (
                <li key={c.id} data-comment-id={c.id} className={flashId === c.id ? 'is-flashed' : undefined}>
                  <span className="pubws-comment-head">
                    <span className="pubws-comment-who">{c.fromName}</span>
                    <span className="pubws-comment-when">{timeAgo(c.createdAt)}</span>
                  </span>
                  <p className="pubws-comment-text">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
          {canPost ? (
            <div className="pubws-comments-composer">
              <textarea
                className="jobform-line jobform-line--desc pubws-comment-input"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Say what you see."
                rows={2}
                maxLength={5000}
                aria-label="Write a comment"
              />
              <button className="acctdlg-ghost" disabled={busy || !draft.trim()} onClick={() => void post()}>
                {busy ? 'Posting…' : 'Post'}
              </button>
            </div>
          ) : (
            <button className="pubws-comments-signup" onClick={onRequireSignup}>
              Sign up to join the conversation
            </button>
          )}
          {error && <p className="ticket-err">{error}</p>}
        </div>
      )}

      {tab === 'positions' && (
        <div className="pubws-comments-body">
          {activity === null ? (
            <p className="pubws-comments-empty">…</p>
          ) : activity.positions.length === 0 ? (
            <p className="pubws-comments-empty">Nobody holds this market yet.</p>
          ) : (
            <ul className="pubws-mkt-list">
              {activity.positions.map((p, i) => (
                <li key={`${p.id}-${p.direction}-${i}`} className="pubws-mkt-row">
                  <span className={`prof-dir prof-dir--${p.direction}`}>{p.direction === 'higher' ? '▲' : '▼'}</span>
                  <Link className="pubws-mkt-who pubws-name-link" to={profileHref(p.handle, p.id)}>
                    {p.handle}
                  </Link>
                  {p.branch && <span className="pubws-mkt-branch">if {p.branch}</span>}
                  <span className="pubws-mkt-val">
                    {fmtShares(p.shares)} sh{p.worth !== null ? ` · ${fmtCr(p.worth)} cr` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="pubws-comments-body">
          {activity === null ? (
            <p className="pubws-comments-empty">…</p>
          ) : merged.length === 0 ? (
            <p className="pubws-comments-empty">Nothing yet: no pool behind it and nobody in it.</p>
          ) : (
            <ul className="pubws-mkt-list" ref={activityRef}>
              {merged.map(item =>
                item.row === 'trade' ? (
                  <li
                    key={item.id}
                    className={`pubws-mkt-row${flashId === item.id ? ' is-flashed' : ''}`}
                    data-trade-id={item.id}
                  >
                    <span className={`prof-dir prof-dir--${item.direction}`}>
                      {item.direction === 'higher' ? '▲' : '▼'}
                    </span>
                    <Link className="pubws-mkt-who pubws-name-link" to={profileHref(item.handle, item.handle)}>
                      {item.handle}
                    </Link>
                    {item.branch && <span className="pubws-mkt-branch">if {item.branch}</span>}
                    <span className="pubws-mkt-act">
                      {item.kind === 'buy' ? 'bought' : 'sold'} {fmtShares(item.shares)}
                      {/* The price per share, so this row and the profile's say
                        the same thing about one trade. */}
                      {item.shares > 0 ? ` at ${(item.cost / item.shares).toFixed(3)} cr` : ''}
                    </span>
                    <span className="pubws-mkt-val">{fmtCr(item.cost)} cr</span>
                    <span className="pubws-mkt-time">{timeAgo(item.createdAt)}</span>
                  </li>
                ) : (
                  <li key={item.id} className="pubws-mkt-row">
                    {/* A drop, in ink rather than a direction colour: the pool
                      is not a side of the market. */}
                    <span className="prof-dir pubws-mkt-drop" aria-hidden="true">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
                      </svg>
                    </span>
                    {item.handle ? (
                      <Link className="pubws-mkt-who pubws-name-link" to={profileHref(item.handle, item.handle)}>
                        {item.handle}
                      </Link>
                    ) : (
                      <span className="pubws-mkt-who">the house</span>
                    )}
                    {item.branch && <span className="pubws-mkt-branch">if {item.branch}</span>}
                    <span className="pubws-mkt-act pubws-mkt-act--pool">
                      {item.kind === 'opened' ? 'opened it with' : 'deepened the pool by'} {fmtCr(item.amount)}
                    </span>
                    <span className="pubws-mkt-val">pool {fmtCr(item.pool)} cr</span>
                    <span className="pubws-mkt-time">{timeAgo(item.createdAt)}</span>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
