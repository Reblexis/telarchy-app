import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Announcement } from '../lib/api';

/**
 * The owner's announcements on the public floor.
 *
 * A charter that promises "if something material happens that the market
 * cannot see, I announce it within 24 hours" needs somewhere for the
 * announcement to land, and comments (which hang off one market or one
 * proposal) are not it. This is that surface: workspace-level, public,
 * newest first, and append-only (docs/vision.md, "Workspace announcements").
 *
 * The latest one is always open, because a trader arriving mid-market should
 * meet the most recent disclosure rather than go looking for it; older ones
 * are one click away. An edited announcement says so, prints both timestamps,
 * and can show the text it replaced. Hiding any of that would turn a record a
 * trader can check back into the owner's word.
 */

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Body({ text }: { text: string }) {
  return (
    <div className="pubws-ann-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AnnouncementRow({ item, workspaceId, canManage, onEdited }: {
  item: Announcement;
  workspaceId: string;
  canManage: boolean;
  onEdited: (updated: Announcement) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <article className="pubws-ann">
      <div className="pubws-ann-meta">
        <time dateTime={item.publishedAt}>{fmtWhen(item.publishedAt)}</time>
        {item.editedAt && (
          <>
            <span className="pubws-ann-edited">edited {fmtWhen(item.editedAt)}</span>
            {item.originalBody && (
              <button className="pubws-ann-link" onClick={() => setShowOriginal(v => !v)}>
                {showOriginal ? 'hide what it said' : 'what it said before'}
              </button>
            )}
          </>
        )}
        {canManage && !editing && (
          <button className="pubws-ann-link" onClick={() => { setDraft(item.body); setErr(''); setEditing(true); }}>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="pubws-ann-editor">
          <textarea
            className="jobform-line jobform-line--desc pubws-ann-editarea"
            rows={8}
            maxLength={5000}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-label="Edit announcement"
          />
          {/* Said before the save, not after: an owner correcting a typo and
              an owner rewriting a disclosure press the same button, and only
              one of them should be surprised by the result. */}
          <p className="pubws-ann-warn">
            The version already published stays public, with the time of this edit beside it.
          </p>
          {err && <p className="ticket-err">{err}</p>}
          <div className="pubws-ann-actions">
            <button
              className="ticket-go"
              disabled={busy}
              onClick={() => {
                setBusy(true); setErr('');
                void (async () => {
                  try {
                    onEdited(await api.editAnnouncement(workspaceId, item.id, draft));
                    setEditing(false);
                  } catch (e) {
                    setErr((e as Error).message || 'Could not save');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="pubws-ghost" onClick={() => { setEditing(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <Body text={item.body} />
          {showOriginal && item.originalBody && (
            <div className="pubws-ann-original">
              <span className="pubws-ann-original-label">As first published</span>
              <Body text={item.originalBody} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function FloorAnnouncements({ workspaceId, idOrSlug, latest, total, canManage }: {
  workspaceId: string;
  /** What the public read route is addressed by (slug or id), the same thing
   *  the floor was loaded with. */
  idOrSlug: string;
  /** The newest announcement, shipped inline on the workspace payload. */
  latest: Announcement | null | undefined;
  /** How many exist in total, so the section can offer the rest honestly. */
  total: number;
  canManage: boolean;
}) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listErr, setListErr] = useState('');
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // The newest announcement as this session has changed it: set by publishing
  // one, and by editing whichever one is on top. Without it the page would
  // keep rendering the payload's copy, so an owner's own correction would look
  // like it had not saved.
  const [newestLocal, setNewestLocal] = useState<Announcement | null>(null);
  const [publishedHere, setPublishedHere] = useState(0);

  // `total` is the count the payload was built with; a publish in this session
  // is one more than that, so the "N earlier" offer stays honest without a
  // reload.
  const newest = newestLocal ?? latest ?? null;
  const olderCount = Math.max(0, total + publishedHere - 1);

  // Nothing published and nothing the visitor could do about it: render no
  // section at all rather than an empty heading on every floor.
  if (!newest && !canManage) return null;

  const loadAll = async () => {
    if (items) { setExpanded(v => !v); return; }
    setLoading(true); setListErr('');
    try {
      const res = await api.getWorkspaceAnnouncements(idOrSlug);
      setItems(res.announcements);
      setExpanded(true);
    } catch (e) {
      setListErr((e as Error).message || 'Could not load announcements');
    } finally {
      setLoading(false);
    }
  };

  const replaceInList = (updated: Announcement) => {
    if (newest?.id === updated.id) setNewestLocal(updated);
    setItems(cur => cur?.map(a => (a.id === updated.id ? updated : a)) ?? cur);
  };

  const shown = expanded && items ? items : newest ? [newest] : [];

  return (
    <section className="pubws-know pubws-enter pubws-enter--3" aria-label="Announcements">
      <div className="pubws-know-headrow">
        <h2 className="pubws-know-head">Announcements</h2>
        {canManage && !composing && (
          <button className="pubws-know-edit" onClick={() => { setDraft(''); setErr(''); setComposing(true); }}>
            New
          </button>
        )}
      </div>

      {canManage && composing && (
        <div className="pubws-ann-editor">
          <textarea
            className="jobform-line jobform-line--desc pubws-ann-editarea"
            rows={8}
            maxLength={5000}
            placeholder="Something material the market cannot see yet."
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-label="New announcement"
          />
          <p className="pubws-ann-warn">
            Published announcements cannot be deleted, and the time is stamped by the server.
            An edit keeps the original visible.
          </p>
          {err && <p className="ticket-err">{err}</p>}
          <div className="pubws-ann-actions">
            <button
              className="ticket-go"
              disabled={busy || draft.trim().length === 0}
              onClick={() => {
                setBusy(true); setErr('');
                void (async () => {
                  try {
                    const created = await api.publishAnnouncement(workspaceId, draft);
                    setNewestLocal(created);
                    setPublishedHere(n => n + 1);
                    setItems(cur => (cur ? [created, ...cur] : cur));
                    setComposing(false);
                    setDraft('');
                  } catch (e) {
                    setErr((e as Error).message || 'Could not publish');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
            <button className="pubws-ghost" onClick={() => { setComposing(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="pubws-ann-empty">Nothing announced yet.</p>
      ) : (
        shown.map(a => (
          <AnnouncementRow key={a.id} item={a} workspaceId={workspaceId} canManage={canManage} onEdited={replaceInList} />
        ))
      )}

      {olderCount > 0 && (
        <button className="pubws-ann-more" onClick={() => void loadAll()} disabled={loading}>
          {loading ? 'Loading…' : expanded ? 'Show only the latest' : `${olderCount} earlier`}
        </button>
      )}
      {listErr && <p className="ticket-err">{listErr}</p>}
    </section>
  );
}
