import { useEffect, useState } from 'react';
import { api, type XPost, type XReply, type XSummary } from '../lib/api';

/**
 * The X workbench (docs/x-workbench.md): paste a post, argue about the reply,
 * record what you sent, watch what it earned.
 *
 * The argument is the point. A first draft is a starting position, and the
 * turns below it are where the owner's judgement enters, so the conversation
 * stays on screen instead of each draft replacing the last.
 */
export function XWorkbench() {
  const [input, setInput] = useState('');
  const [post, setPost] = useState<XPost | null>(null);
  const [manualText, setManualText] = useState('');
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [draft, setDraft] = useState<{ reply: string; reason: string; note?: string } | null>(null);
  const [edited, setEdited] = useState('');
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [log, setLog] = useState<XReply[] | null>(null);
  const [summary, setSummary] = useState<XSummary | null>(null);
  const [configured, setConfigured] = useState(true);
  const [profile, setProfile] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const refreshLog = () =>
    api
      .xLog()
      .then(r => {
        setLog(r.replies);
        setSummary(r.summary);
        setConfigured(r.draftingConfigured);
      })
      .catch(e => setErr((e as Error).message));

  useEffect(() => {
    refreshLog();
  }, []);

  const text = post?.text || manualText;

  const lookup = () => {
    setErr('');
    setDraft(null);
    setTurns([]);
    setBusy('lookup');
    api
      .xLookupPost(input)
      .then(r => {
        setPost(r.post);
        setManualText('');
      })
      .catch(e => {
        // The X read is undocumented and will break one day. Say so and let
        // him paste the text: drafting only ever needed the words.
        setPost(null);
        setErr(`${(e as Error).message} You can paste the post text below instead.`);
      })
      .finally(() => setBusy(''));
  };

  const ask = (message?: string) => {
    if (!text.trim()) {
      setErr('No post text to work from.');
      return;
    }
    setErr('');
    setBusy('draft');
    const next = message ? [...turns, { role: 'user' as const, content: message }] : turns;
    api
      .xDraftReply({
        postId: post?.id,
        postAuthor: post?.author,
        postText: text,
        messages: next,
      })
      .then(r => {
        setDraft(r.draft);
        setEdited(r.draft.reply);
        setTurns([
          ...next,
          { role: 'assistant', content: JSON.stringify({ reply: r.draft.reply, reason: r.draft.reason }) },
        ]);
        setSay('');
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const record = () => {
    if (!edited.trim()) return;
    setBusy('record');
    api
      .xRecordReply({
        sourcePostId: post?.id ?? input,
        sourceAuthor: post?.author,
        sourceText: text,
        text: edited,
      })
      .then(() => {
        refreshLog();
        setDraft(null);
        setTurns([]);
        setEdited('');
        setPost(null);
        setInput('');
        setManualText('');
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const intent = edited.trim()
    ? `https://x.com/intent/post?text=${encodeURIComponent(edited)}${post ? `&in_reply_to=${post.id}` : ''}`
    : '';

  return (
    <section className="adm-block">
      <h2 className="pubws-h2">X workbench</h2>
      <p className="adm-note">
        Paste a post, argue about the reply until it is right, send it yourself, then paste back the id of your reply so
        this can watch what it earned. Nothing here posts to X.
        {!configured ? ' Drafting is off until ANTHROPIC_API_KEY is set on the server.' : ''}
      </p>

      <form
        className="adm-payform"
        onSubmit={e => {
          e.preventDefault();
          lookup();
        }}
      >
        <input
          className="adm-payq"
          placeholder="x.com/someone/status/123... or just the id"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button className="adm-paygo" type="submit" disabled={busy === 'lookup' || !input.trim()}>
          {busy === 'lookup' ? 'Reading' : 'Read post'}
        </button>
      </form>

      {err ? <p className="adm-err">{err}</p> : null}

      {post ? (
        <div className="xw-post">
          <div className="adm-report-head">
            <strong>@{post.author}</strong>
            <span className="adm-sub">
              {post.likes} likes · {post.replies} replies
              {post.createdAt ? ` · ${post.createdAt.slice(0, 10)}` : ''}
            </span>
          </div>
          <p className="adm-report-body">{post.text}</p>
        </div>
      ) : (
        <textarea
          className="xw-paste"
          placeholder="Or paste the post text here and draft against it"
          value={manualText}
          onChange={e => setManualText(e.target.value)}
          rows={3}
        />
      )}

      {text.trim() ? (
        <>
          <div className="xw-actions">
            <button className="adm-paygo" onClick={() => ask()} disabled={busy === 'draft' || !configured}>
              {busy === 'draft' ? 'Thinking' : draft ? 'Draft again' : 'Draft a reply'}
            </button>
          </div>

          {draft ? (
            <div className="xw-draft">
              <span className="adm-tag">{draft.reason}</span>
              {draft.note ? <p className="adm-sub">{draft.note}</p> : null}
              <textarea
                className="adm-payq"
                value={edited}
                onChange={e => setEdited(e.target.value)}
                rows={4}
                aria-label="The reply you will send"
              />
              <div className="xw-actions">
                {intent ? (
                  <a className="adm-paygo" href={intent} target="_blank" rel="noreferrer">
                    Open X with this
                  </a>
                ) : null}
                <button className="adm-paygo" onClick={record} disabled={busy === 'record' || !edited.trim()}>
                  I sent this
                </button>
              </div>

              {/* The argument. Each turn is kept so "shorter" means shorter
                  than the last draft, not shorter than nothing. */}
              <form
                className="adm-payform"
                onSubmit={e => {
                  e.preventDefault();
                  if (say.trim()) ask(say.trim());
                }}
              >
                <input
                  className="adm-payq"
                  placeholder="Tell it what is wrong: shorter, lead with the number, you are wrong about..."
                  value={say}
                  onChange={e => setSay(e.target.value)}
                />
                <button className="adm-paygo" type="submit" disabled={busy === 'draft' || !say.trim()}>
                  Push back
                </button>
              </form>
              {turns.filter(t => t.role === 'user').length ? (
                <ul className="adm-list xw-turns">
                  {turns
                    .filter(t => t.role === 'user')
                    .map((t, i) => (
                      <li key={i} className="adm-sub">
                        you: {t.content}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <h3 className="pubws-h2 xw-h3">What you sent</h3>
      {summary ? (
        <p className="adm-note">
          {summary.enough ? (
            <>
              Median {summary.median} likes, {summary.anyEngagement}% got any engagement.{' '}
              {summary.features.map(f => `${f.label}: ${f.on} vs ${f.off}`).join(' · ')}
            </>
          ) : (
            summary.note
          )}
        </p>
      ) : null}
      {log === null ? null : log.length === 0 ? (
        <p className="adm-empty">Nothing recorded yet.</p>
      ) : (
        <ul className="adm-list">
          {log.map(r => (
            <li key={r.id} className="adm-report">
              <div className="adm-report-head">
                <span className="adm-sub">
                  to @{r.sourceAuthor ?? 'unknown'} · {r.createdAt.slice(0, 10)}
                </span>
                <span className="adm-sub">
                  {r.replyId ? `${r.likes ?? '?'} likes · ${r.replies ?? '?'} replies` : 'no id yet, not tracked'}
                </span>
              </div>
              <p className="adm-report-body">{r.text}</p>
              {!r.replyId ? (
                <form
                  className="adm-payform"
                  onSubmit={e => {
                    e.preventDefault();
                    const field = (e.currentTarget.elements.namedItem('rid') as HTMLInputElement) || null;
                    if (field?.value.trim()) {
                      api
                        .xAttachReplyId(r.id, field.value.trim())
                        .then(refreshLog)
                        .catch(x => setErr((x as Error).message));
                    }
                  }}
                >
                  <input className="adm-payq" name="rid" placeholder="url or id of the reply you posted" />
                  <button className="adm-paygo" type="submit">
                    Track it
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="adm-note">
        <button
          className="adm-linkbtn"
          onClick={() => {
            setProfileOpen(o => !o);
            if (profile === null) {
              api
                .xGetVoiceProfile()
                .then(r => setProfile(r.profile))
                .catch(e => setErr((e as Error).message));
            }
          }}
        >
          {profileOpen ? 'Hide' : 'Edit'} the voice profile
        </button>{' '}
        the samples the drafts imitate and the facts they are allowed to state. Kept in the database, not in the repo.
      </p>
      {profileOpen ? (
        <div className="xw-profile">
          <textarea
            className="adm-payq"
            rows={10}
            value={profile ?? ''}
            onChange={e => setProfile(e.target.value)}
            placeholder="Writing samples, then the facts a draft may state. Anything not in here, a draft must not claim."
          />
          <button
            className="adm-paygo"
            onClick={() => {
              setBusy('profile');
              api
                .xSetVoiceProfile(profile ?? '')
                .then(() => setProfileOpen(false))
                .catch(e => setErr((e as Error).message))
                .finally(() => setBusy(''));
            }}
            disabled={busy === 'profile'}
          >
            Save profile
          </button>
        </div>
      ) : null}
    </section>
  );
}
