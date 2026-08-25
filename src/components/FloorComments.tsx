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
 * belongs to the contract and survives switching branch, while the market
 * ids route POSITIONS AND TRADES. A caller that passes only the proposal
 * gets comments and no activity at all (the tabs hide themselves), which
 * is how a contract with a real trade in it rendered as "Comments (0)"
 * and nothing else.
 *
 * A contract passes BOTH branch markets, labeled, and the tabs show their
 * union (owner report 2026-08-21: "why dont i see any trades made on the
 * conditional markets"). Scoping activity to the branch on screen was the
 * same bug in a subtler coat: a contract opens on "if approved", so a
 * contract whose trades all sat on the declined branch answered
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

type BranchLabel = 'approved' | 'declined';

interface Props {
  idOrSlug: string;
  /** The market(s) drive positions/trades; proposalId routes the comment
   *  thread. A contract passes `markets` with both labeled branches and the
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
  onFocusHandled?: () => void;
}

type Tab = 'comments' | 'positions' | 'trades' | null;

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
  onFocusHandled,
}: Props) {
  const [tab, setTab] = useState<Tab>(null);
  const activityReqRef = useRef(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [activity, setActivity] = useState<{ positions: Holder[]; trades: TradeItem[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every market whose activity belongs on the tabs: both labeled branches
  // of a contract, or the one baseline market. The key is order-stable so a
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
  // fetch per market, merged: a contract's two branches answer together,
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
          }))
          .catch(e => {
            console.error('market activity fetch failed:', e);
            return { positions: [], trades: [] };
          }),
      ),
    ).then(parts => {
      if (token !== activityReqRef.current) return;
      setActivity({
        positions: parts.flatMap(p => p.positions),
        trades: parts
          .flatMap(p => p.trades)
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
  const tCount = activity?.trades?.length ?? null;

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
              className={`pubws-comments-toggle${tab === 'trades' ? ' is-active' : ''}`}
              aria-expanded={tab === 'trades'}
              onClick={() => toggle('trades')}
            >
              Trades{tCount !== null ? ` (${tCount})` : ''}
            </button>
          </>
        )}
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

      {tab === 'trades' && (
        <div className="pubws-comments-body">
          {activity === null ? (
            <p className="pubws-comments-empty">…</p>
          ) : activity.trades.length === 0 ? (
            <p className="pubws-comments-empty">No trades yet.</p>
          ) : (
            <ul className="pubws-mkt-list">
              {activity.trades.map(t => (
                <li key={t.id} className="pubws-mkt-row">
                  <span className={`prof-dir prof-dir--${t.direction}`}>{t.direction === 'higher' ? '▲' : '▼'}</span>
                  <Link className="pubws-mkt-who pubws-name-link" to={profileHref(t.handle, t.handle)}>
                    {t.handle}
                  </Link>
                  {t.branch && <span className="pubws-mkt-branch">if {t.branch}</span>}
                  <span className="pubws-mkt-act">
                    {t.kind === 'buy' ? 'bought' : 'sold'} {fmtShares(t.shares)}
                  </span>
                  <span className="pubws-mkt-val">{fmtCr(t.cost)} cr</span>
                  <span className="pubws-mkt-time">{timeAgo(t.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
