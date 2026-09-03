import { useEffect, useState } from 'react';
import { api, type XPost, type XReply, type XSearch, type XSummary } from '../lib/api';

type Turn = { role: 'user' | 'assistant'; content: string };

/** What it said to him on an assistant turn, kept inside the turn so the
 *  model remembers what it said and the screen can show it. */
function answerOf(turn: Turn): string {
  try {
    const parsed = JSON.parse(turn.content) as { answer?: string };
    return parsed.answer ?? '';
  } catch {
    return '';
  }
}

/**
 * The X workbench (docs/x-workbench.md): paste a post and argue about the
 * reply, or give it an idea and argue about the post; record what you sent,
 * watch what it earned.
 *
 * The argument is the point. A first draft is a starting position, and the
 * turns below it are where the owner's judgement enters, so the conversation
 * stays on screen, both sides of it, instead of each draft replacing the last.
 */
export function XWorkbench() {
  const [mode, setMode] = useState<'reply' | 'post'>('reply');
  const [idea, setIdea] = useState('');
  const [input, setInput] = useState('');
  const [post, setPost] = useState<XPost | null>(null);
  const [manualText, setManualText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<{
    text: string;
    reason: string;
    answer: string;
  } | null>(null);
  const [edited, setEdited] = useState('');
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [log, setLog] = useState<XReply[] | null>(null);
  const [summary, setSummary] = useState<XSummary | null>(null);
  const [configured, setConfigured] = useState(true);
  const [profile, setProfile] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    query: string;
    rationale: string;
    answer: string;
  } | null>(null);
  const [suggestTurns, setSuggestTurns] = useState<Turn[]>([]);
  const [suggestSay, setSuggestSay] = useState('');
  const [search, setSearch] = useState<XSearch | null>(null);
  const [harvestIds, setHarvestIds] = useState('');
  const [candidates, setCandidates] = useState<XPost[] | null>(null);
  const [searches, setSearches] = useState<XSearch[] | null>(null);

  const refreshLog = () =>
    api
      .xLog()
      .then(r => {
        setLog(r.replies);
        setSummary(r.summary);
        setConfigured(r.draftingConfigured);
      })
      .catch(e => setErr((e as Error).message));

  const refreshSearches = () =>
    api
      .xSearches()
      .then(r => setSearches(r.searches))
      .catch(() => setSearches([]));

  useEffect(() => {
    refreshLog();
    refreshSearches();
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

  /** A search proposal, or one more turn of the argument about it. A fresh
   *  proposal avoids every query already tried or proposed; a push-back
   *  keeps the conversation so "narrower" means narrower than this one. */
  const propose = (message?: string) => {
    setErr('');
    setBusy('suggest');
    const fresh = !message;
    const avoid = (searches ?? []).map(x => x.query).concat(fresh && suggestion ? [suggestion.query] : []);
    const next = fresh ? [] : [...suggestTurns, { role: 'user' as const, content: message }];
    api
      .xSuggestSearch(avoid, next)
      .then(r => {
        setSuggestion(r.suggestion);
        setSuggestTurns([...next, { role: 'assistant', content: JSON.stringify(r.suggestion) }]);
        setSuggestSay('');
        setSearch(null);
        setCandidates(null);
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const switchMode = (m: 'reply' | 'post') => {
    if (m === mode) return;
    setMode(m);
    setDraft(null);
    setTurns([]);
    setEdited('');
    setErr('');
  };

  /** One turn of the argument, in either mode. The whole conversation goes
   *  back every time, and the assistant turn keeps its answer so the model
   *  remembers what it said and the screen can show it. */
  const ask = (message?: string) => {
    const source = mode === 'post' ? idea : text;
    if (!source.trim()) {
      setErr(mode === 'post' ? 'No idea to work from.' : 'No post text to work from.');
      return;
    }
    setErr('');
    setBusy('draft');
    const next = message ? [...turns, { role: 'user' as const, content: message }] : turns;
    const call =
      mode === 'post'
        ? api.xDraftPost({ idea, messages: next }).then(r => ({
            text: r.draft.post,
            reason: r.draft.reason,
            answer: r.draft.answer,
          }))
        : api
            .xDraftReply({
              postId: post?.id,
              postAuthor: post?.author,
              postText: text,
              messages: next,
            })
            .then(r => ({
              text: r.draft.reply,
              reason: r.draft.reason,
              answer: r.draft.answer,
            }));
    call
      .then(d => {
        setDraft(d);
        setEdited(d.text);
        setTurns([...next, { role: 'assistant', content: JSON.stringify(d) }]);
        setSay('');
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const record = () => {
    if (!edited.trim()) return;
    setBusy('record');
    const body =
      mode === 'post'
        ? { kind: 'post' as const, text: edited }
        : {
            kind: 'reply' as const,
            sourcePostId: post?.id ?? input,
            sourceAuthor: post?.author,
            sourceText: text,
            text: edited,
            searchId: search?.id,
          };
    api
      .xRecordReply(body)
      .then(() => {
        refreshLog();
        setDraft(null);
        setTurns([]);
        setEdited('');
        setPost(null);
        setInput('');
        setManualText('');
        setIdea('');
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const intent = edited.trim()
    ? `https://x.com/intent/post?text=${encodeURIComponent(edited)}${mode === 'reply' && post ? `&in_reply_to=${post.id}` : ''}`
    : '';
  const ready = mode === 'post' ? idea.trim() : text.trim();

  return (
    <section className="adm-block">
      <h2 className="pubws-h2">X workbench</h2>
      <p className="adm-note">
        Paste a post and argue about the reply, or give it an idea and argue about the post, until it is right. Send it
        yourself, then paste back the id so this can watch what it earned. Nothing here posts to X.
        {!configured ? ' Drafting is off until ANTHROPIC_API_KEY is set on the server.' : ''}
      </p>

      {/* The search loop. X search needs a credential we do not have, so the
          machine proposes the query, he runs it, and he pastes back the ids.
          What each query produced is what shapes the next proposal. */}
      <div className="xw-search">
        <div className="xw-actions">
          <button className="adm-paygo" onClick={() => propose()} disabled={busy === 'suggest' || !configured}>
            {busy === 'suggest' ? 'Thinking' : suggestion ? 'Another search' : 'Get a search prompt'}
          </button>
          {searches?.length ? <span className="adm-sub">{searches.length} tried so far</span> : null}
        </div>

        {suggestion ? (
          <div className="xw-draft">
            <code className="xw-query">{suggestion.query}</code>
            {suggestion.rationale ? <p className="adm-sub">{suggestion.rationale}</p> : null}
            {suggestion.answer ? <p className="adm-sub xw-answer">{suggestion.answer}</p> : null}
            <form
              className="adm-payform"
              onSubmit={e => {
                e.preventDefault();
                if (suggestSay.trim()) propose(suggestSay.trim());
              }}
            >
              <input
                className="adm-payq"
                placeholder="Argue with it: narrower, not about Polymarket, why this one?"
                value={suggestSay}
                onChange={e => setSuggestSay(e.target.value)}
              />
              <button className="adm-paygo" type="submit" disabled={busy === 'suggest' || !suggestSay.trim()}>
                Argue
              </button>
            </form>
            {suggestTurns.length > 1 ? (
              <ul className="adm-list xw-turns">
                {suggestTurns.slice(0, -1).map((t, i) => (
                  <li key={i} className={t.role === 'user' ? 'adm-sub' : 'adm-sub xw-answer'}>
                    {t.role === 'user' ? `you: ${t.content}` : `it: ${answerOf(t)}`}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="xw-actions">
              <a
                className="adm-paygo"
                href={`https://x.com/search?q=${encodeURIComponent(suggestion.query)}&f=live`}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  // Taking the query is what makes it worth remembering: from
                  // here on its yield is counted against it.
                  if (!search) {
                    api
                      .xSaveSearch(suggestion.query, suggestion.rationale)
                      .then(r => {
                        setSearch(r.search);
                        refreshSearches();
                      })
                      .catch(e => setErr((e as Error).message));
                  }
                }}
              >
                Run it on X
              </a>
            </div>
            {search ? (
              <form
                className="xw-harvest"
                onSubmit={e => {
                  e.preventDefault();
                  if (!harvestIds.trim()) return;
                  setBusy('harvest');
                  api
                    .xHarvestSearch(search.id, harvestIds)
                    .then(r => {
                      setCandidates(r.posts);
                      if (r.failed.length) setErr(`Could not read: ${r.failed.join(', ')}`);
                      setHarvestIds('');
                      refreshSearches();
                    })
                    .catch(e => setErr((e as Error).message))
                    .finally(() => setBusy(''));
                }}
              >
                <textarea
                  className="xw-paste"
                  rows={2}
                  placeholder="Paste the post links or ids you found, separated by spaces or newlines"
                  value={harvestIds}
                  onChange={e => setHarvestIds(e.target.value)}
                />
                <button className="adm-paygo" type="submit" disabled={busy === 'harvest' || !harvestIds.trim()}>
                  {busy === 'harvest' ? 'Reading' : 'Read these'}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {candidates?.length ? (
          <ul className="adm-list">
            {candidates.map(c => (
              <li key={c.id} className="adm-report">
                <div className="adm-report-head">
                  <strong>@{c.author}</strong>
                  <span className="adm-sub">
                    {c.likes} likes · {c.replies} replies
                  </span>
                </div>
                <p className="adm-report-body">{c.text}</p>
                <button
                  className="adm-paygo"
                  onClick={() => {
                    setPost(c);
                    setDraft(null);
                    setTurns([]);
                    setInput(c.id);
                  }}
                >
                  Work on this one
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Two ways in: someone's post, or his own idea. Same argument after. */}
      <div className="xw-actions xw-modes">
        <button className="adm-paygo" aria-pressed={mode === 'reply'} onClick={() => switchMode('reply')}>
          Answer a post
        </button>
        <button className="adm-paygo" aria-pressed={mode === 'post'} onClick={() => switchMode('post')}>
          Write a post
        </button>
      </div>

      {mode === 'reply' ? (
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
      ) : (
        <textarea
          className="xw-paste"
          placeholder="Your idea, a number you want to say, or a rough draft of the post"
          value={idea}
          onChange={e => setIdea(e.target.value)}
          rows={3}
        />
      )}

      {err ? <p className="adm-err">{err}</p> : null}

      {mode === 'post' ? null : post ? (
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

      {ready ? (
        <>
          <div className="xw-actions">
            <button className="adm-paygo" onClick={() => ask()} disabled={busy === 'draft' || !configured}>
              {busy === 'draft'
                ? 'Thinking'
                : draft
                  ? 'Draft again'
                  : mode === 'post'
                    ? 'Draft a post'
                    : 'Draft a reply'}
            </button>
          </div>

          {draft ? (
            <div className="xw-draft">
              <span className="adm-tag">{draft.reason}</span>
              {draft.answer ? <p className="adm-sub xw-answer">{draft.answer}</p> : null}
              <textarea
                className="adm-payq"
                value={edited}
                onChange={e => setEdited(e.target.value)}
                rows={4}
                aria-label={mode === 'post' ? 'The post you will publish' : 'The reply you will send'}
              />
              <div className="xw-actions">
                {intent ? (
                  <a className="adm-paygo" href={intent} target="_blank" rel="noreferrer">
                    Open X with this
                  </a>
                ) : null}
                <button className="adm-paygo" onClick={record} disabled={busy === 'record' || !edited.trim()}>
                  {mode === 'post' ? 'I posted this' : 'I sent this'}
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
                  placeholder="Tell it what is wrong, or ask it something: shorter, lead with the number, why that line?"
                  value={say}
                  onChange={e => setSay(e.target.value)}
                />
                <button className="adm-paygo" type="submit" disabled={busy === 'draft' || !say.trim()}>
                  Push back
                </button>
              </form>
              {/* Both sides, oldest first, so the exchange reads as one. The
                  latest answer is already above the draft; the rest is here. */}
              {turns.length > 1 ? (
                <ul className="adm-list xw-turns">
                  {turns.slice(0, -1).map((t, i) => (
                    <li key={i} className={t.role === 'user' ? 'adm-sub' : 'adm-sub xw-answer'}>
                      {t.role === 'user' ? `you: ${t.content}` : `it: ${answerOf(t)}`}
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
                  {r.kind === 'post' ? 'your post' : `to @${r.sourceAuthor ?? 'unknown'}`} · {r.createdAt.slice(0, 10)}
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
                  <input className="adm-payq" name="rid" placeholder="url or id of what you posted" />
                  <button className="adm-paygo" type="submit">
                    Track it
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {searches?.length ? (
        <>
          <h3 className="pubws-h2 xw-h3">Searches tried</h3>
          <ul className="adm-list">
            {searches.map(x => (
              <li key={x.id} className="adm-report">
                <code className="xw-query">{x.query}</code>
                <p className="adm-sub">
                  {x.harvested} posts read · {x.replies ?? 0} replies sent · {x.likes ?? 0} likes earned
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

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
