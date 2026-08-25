import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../hooks/useAuth';
import { type Announcement, api, type PublicWorkspace } from '../lib/api';
import { TopBar } from './TradePage';

/**
 * telarchy.com/<floor>/announcements: the workspace's disclosures, all of
 * them, the owner's and any named delegate's.
 *
 * The floor used to print the latest announcement in full and hide the rest
 * behind an expander (owner direction 2026-08-20: "just show the headline on
 * the main page, and only if clicked then go to the announcements page"). The
 * floor's job is the market; a disclosure record is a document, and documents
 * get their own page and the wider column.
 *
 * What makes this page different from a blog is stated on it rather than
 * implied: published announcements cannot be deleted or backdated (a database
 * trigger, migration 0057, refuses both), and an edit keeps the original
 * readable. That sentence is the reason the page is worth checking, so it sits
 * under the headline and not in a footer.
 *
 * Each entry is headed by its publication instant, in the mono face the rest
 * of the product uses for numbers, because in an append-only record the time
 * is the entry's identity.
 */

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Body({ text }: { text: string }) {
  return (
    <div className="pubws-ann-body">
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
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AnnouncementRow({
  item,
  workspaceId,
  canManage,
  onEdited,
}: {
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
        <time className="annp-when" dateTime={item.publishedAt}>
          {fmtWhen(item.publishedAt)}
        </time>
        {/* A delegate's post says so, in the same muted register as the
            edited marker; the owner's own words stay unlabelled. */}
        {item.publishedBy && <span className="pubws-ann-edited">by {item.publishedBy}</span>}
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
          <button
            className="pubws-ann-link"
            onClick={() => {
              setDraft(item.body);
              setErr('');
              setEditing(true);
            }}
          >
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
                setBusy(true);
                setErr('');
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
            <button
              className="pubws-ghost"
              onClick={() => {
                setEditing(false);
                setErr('');
              }}
            >
              Cancel
            </button>
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

export function AnnouncementsPage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!idOrSlug) return;
    let cancelled = false;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(w => {
        if (!cancelled) setWs(w);
      })
      .catch(e => console.error('workspace fetch failed:', e));
    api
      .getWorkspaceAnnouncements(idOrSlug)
      .then(r => {
        if (!cancelled) setItems(r.announcements);
      })
      .catch(e => {
        console.error('announcements fetch failed:', e);
        if (!cancelled) {
          setItems([]);
          setLoadErr((e as Error).message || 'Could not load announcements');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug]);

  useEffect(() => {
    if (!user) return;
    api
      .getProfile()
      .then(p => setCanManage((p as { authRole?: string }).authRole === 'admin'))
      .catch(e => console.error('profile fetch failed:', e));
  }, [user]);

  const floorHref = params.workspaceId ? `/marketplace/${params.workspaceId}` : `/${params.slug ?? ''}`;

  const replaceInList = (updated: Announcement) => {
    setItems(cur => cur?.map(a => (a.id === updated.id ? updated : a)) ?? cur);
  };

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="pubws-doc annp">
        {/* The slug stands in until the workspace payload lands. That call is
            21KB and has 503'd on a cold instance, and the label is uppercased
            anyway, so "telarchy" and "Telarchy" render identically: the name
            arriving late changes nothing a reader can see, where waiting for
            it left the page saying "back to the floor" for five seconds. */}
        <Link className="annp-back" to={floorHref}>
          {ws?.name ?? params.slug ?? 'Back to the floor'}
        </Link>
        <h1 className="annp-head">Announcements</h1>
        <p className="annp-lead">
          Everything the owner, or a publisher the owner named, has said here that the market could not see for itself.
          A post that is not the owner's says who published it. Published announcements cannot be deleted or backdated,
          and an edit keeps the original readable underneath it.
        </p>

        {canManage &&
          (composing ? (
            <div className="pubws-ann-editor annp-compose">
              <textarea
                className="jobform-line jobform-line--desc pubws-ann-editarea"
                rows={8}
                maxLength={5000}
                placeholder="Something material the market cannot see yet. Open with a short sentence: it is what the floor prints."
                value={draft}
                onChange={e => setDraft(e.target.value)}
                aria-label="New announcement"
              />
              <p className="pubws-ann-warn">
                Published announcements cannot be deleted, and the time is stamped by the server. An edit keeps the
                original visible.
              </p>
              {err && <p className="ticket-err">{err}</p>}
              <div className="pubws-ann-actions">
                <button
                  className="ticket-go"
                  disabled={busy || draft.trim().length === 0}
                  onClick={() => {
                    setBusy(true);
                    setErr('');
                    void (async () => {
                      try {
                        const created = await api.publishAnnouncement(ws!.workspaceId, draft);
                        setItems(cur => [created, ...(cur ?? [])]);
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
                <button
                  className="pubws-ghost"
                  onClick={() => {
                    setComposing(false);
                    setErr('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="annp-new"
              disabled={!ws}
              onClick={() => {
                setDraft('');
                setErr('');
                setComposing(true);
              }}
            >
              Write one
            </button>
          ))}

        {items === null ? null : items.length === 0 ? (
          <p className="pubws-ann-empty">Nothing announced yet.</p>
        ) : (
          <div className="annp-list">
            {items.map(a => (
              <AnnouncementRow
                key={a.id}
                item={a}
                workspaceId={ws?.workspaceId ?? ''}
                canManage={canManage && !!ws}
                onEdited={replaceInList}
              />
            ))}
          </div>
        )}
        {loadErr && <p className="ticket-err">{loadErr}</p>}
      </main>
    </div>
  );
}
