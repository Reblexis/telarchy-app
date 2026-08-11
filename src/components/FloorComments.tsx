import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * The conversation under the one market view (owner ask 2026-08-11):
 * a quiet "Comments (N)" toggle that expands the thread in place. The
 * subject follows the page: the baseline market normally, the selected
 * job's proposal thread when one is open. Reading is public (the floor
 * route); writing needs a signed-in trader and goes through the same
 * authenticated message endpoints the API participants use.
 */

interface Comment { id: string; fromName: string; content: string; createdAt: string }

interface Props {
  idOrSlug: string;
  subject: { marketId?: string; proposalId?: string };
  /** Signed-in and joined: the composer posts. Otherwise it invites. */
  canPost: boolean;
  onRequireSignup: () => void;
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function FloorComments({ idOrSlug, subject, canPost, onRequireSignup }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const subjectKey = subject.proposalId ?? subject.marketId ?? '';

  useEffect(() => {
    if (!subjectKey) return;
    setComments(null);
    api.getFloorComments(idOrSlug, subject)
      .then(setComments)
      .catch(e => { console.error('comments fetch failed:', e); setComments([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrSlug, subjectKey]);

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

  if (!subjectKey) return null;
  const count = comments?.length ?? null;

  return (
    <div className="pubws-comments">
      <button
        className="pubws-comments-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Comments{count !== null ? ` (${count})` : ''}
      </button>

      {open && (
        <div className="pubws-comments-body">
          {comments === null ? (
            <p className="pubws-comments-empty">…</p>
          ) : comments.length === 0 ? (
            <p className="pubws-comments-empty">Nothing yet. Say what you see.</p>
          ) : (
            <ul className="pubws-comments-list">
              {comments.map(c => (
                <li key={c.id}>
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
    </div>
  );
}
