import { useEffect, useState } from 'react';
import { api, type OutreachProspect, type OutreachSummary, type OutreachThreadMessage } from '../lib/api';

type Turn = { role: 'user' | 'assistant'; content: string };

const CHANNELS = ['x', 'email', 'linkedin', 'bluesky', 'hn', 'discord', 'other'];
const STATUSES = ['draft', 'ready', 'approved', 'sent', 'replied', 'call', 'workspace', 'activated', 'no', 'skipped'];

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

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function copy(text: string) {
  try {
    return navigator.clipboard?.writeText(text) ?? Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

/** One item waiting for the owner: a first message in `ready`, or a
 *  follow-up in `draft` with the thread before it. */
type Waiting =
  | { kind: 'first'; key: string; at: string; prospect: OutreachProspect }
  | { kind: 'follow'; key: string; at: string; prospect: OutreachProspect; message: OutreachThreadMessage };

/** Everything waiting for the owner, oldest first (docs/outreach-workbench.md,
 *  "Waiting for you"). */
export function waitingFor(prospects: OutreachProspect[]): Waiting[] {
  const items: Waiting[] = [];
  for (const p of prospects) {
    if (p.status === 'ready' && (p.message ?? '').trim()) {
      items.push({ kind: 'first', key: p.id, at: p.createdAt, prospect: p });
    }
    for (const m of p.thread ?? []) {
      if (m.direction === 'out' && m.status === 'draft') {
        items.push({ kind: 'follow', key: m.id, at: m.createdAt, prospect: p, message: m });
      }
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** One card: who, where they read, the variant, the message to edit, the
 *  reasoning, the evidence folded; Approve saves the edit and approves, Skip
 *  skips. Neither sends. */
function WaitingCard({ item, onDone }: { item: Waiting; onDone: () => void }) {
  const p = item.prospect;
  const original = item.kind === 'first' ? (p.message ?? '') : item.message.text;
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const variant = item.kind === 'first' ? p.variant : item.message.variant;
  const reasoning = item.kind === 'first' ? p.reasoning : item.message.reasoning;
  const before = item.kind === 'follow' ? (p.thread ?? []).filter(m => m.createdAt < item.message.createdAt) : [];

  const act = (status: 'approved' | 'skipped') => {
    setBusy(true);
    setErr('');
    const call =
      item.kind === 'first'
        ? api.outreachUpdate(p.id, status === 'approved' ? { message: text, status } : { status })
        : api.outreachUpdateMessage(item.message.id, status === 'approved' ? { text, status } : { status });
    call
      .then(() => onDone())
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <article className="ow-card">
      <div className="adm-report-head">
        <strong>
          {p.name}
          {p.company ? `, ${p.company}` : ''}
        </strong>
        <span className="adm-sub">
          {item.kind === 'first' ? 'first message' : 'follow-up'}
          {p.segment ? ` · segment ${p.segment}` : ''}
          {' · '}
          {p.link ? (
            <a href={p.link} target="_blank" rel="noreferrer">
              {p.handle ?? p.channel}
            </a>
          ) : (
            (p.handle ?? p.channel)
          )}
        </span>
        {variant ? <span className="ow-variant">{variant}</span> : null}
      </div>
      {before.length ? (
        <ul className="ow-thread">
          {[{ direction: 'out', text: p.sentText ?? p.message ?? '', id: 'first', status: 'sent' }, ...before].map(
            m => (
              <li key={m.id} className={m.direction === 'in' ? 'ow-in' : 'ow-out'}>
                {m.direction === 'in' ? 'them: ' : 'you: '}
                {m.text}
              </li>
            ),
          )}
        </ul>
      ) : null}
      <textarea
        className="ow-message"
        value={text}
        onChange={e => setText(e.target.value)}
        aria-label={`Message to ${p.name}`}
      />
      <span className="ow-words" data-over={words(text) > 75}>
        {words(text)} words
      </span>
      {reasoning ? <p className="ow-reasoning">{reasoning}</p> : null}
      {p.evidence ? (
        <details>
          <summary className="adm-sub">Evidence</summary>
          <p className="ow-evidence">{p.evidence}</p>
        </details>
      ) : null}
      <div className="xw-actions">
        <button className="adm-paygo" onClick={() => act('approved')} disabled={busy || !text.trim()}>
          Approve
        </button>
        <button className="adm-linkbtn" onClick={() => act('skipped')} disabled={busy}>
          Skip
        </button>
        {err ? <span className="adm-err">{err}</span> : null}
      </div>
    </article>
  );
}

/**
 * The outreach workbench (docs/outreach-workbench.md): the people the owner
 * writes to himself, each opened as its evidence beside its message, the
 * argument about the message kept on screen, the link to where the person
 * reads, and what came back. Nothing here sends; he does.
 */
export function OutreachWorkbench() {
  const [prospects, setProspects] = useState<OutreachProspect[] | null>(null);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [configured, setConfigured] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edited, setEdited] = useState('');
  const [evidence, setEvidence] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [say, setSay] = useState('');
  const [outcome, setOutcome] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [draftNew, setDraftNew] = useState({
    name: '',
    company: '',
    segment: '',
    channel: 'x',
    handle: '',
    evidence: '',
  });
  const [lessons, setLessons] = useState<string | null>(null);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [askTurns, setAskTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [learnings, setLearnings] = useState<string | null>(null);
  const [learningsOpen, setLearningsOpen] = useState(false);

  const refresh = () =>
    api
      .outreachProspects()
      .then(r => {
        setProspects(r.prospects);
        setSummary(r.summary);
        setConfigured(r.draftingConfigured);
      })
      .catch(e => setErr((e as Error).message));

  useEffect(() => {
    refresh();
    api
      .outreachGetLessons()
      .then(r => setLessons(r.lessons))
      .catch(() => setLessons(''));
  }, []);

  const open = prospects?.find(p => p.id === openId) ?? null;

  const pick = (p: OutreachProspect) => {
    setOpenId(p.id);
    setEdited(p.message ?? '');
    setEvidence(p.evidence ?? '');
    setTurns(p.conversation ?? []);
    setOutcome(p.outcome ?? '');
    setStatus(p.status);
    setSay('');
    setErr('');
    setNote('');
  };

  const patch = (id: string, input: Parameters<typeof api.outreachUpdate>[1], done = '') => {
    setErr('');
    setBusy('save');
    return api
      .outreachUpdate(id, input)
      .then(r => {
        setProspects(ps => (ps ?? []).map(p => (p.id === id ? { ...p, ...r.prospect } : p)));
        if (done) setNote(done);
        return refresh();
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  /** A draft, or one more turn of the argument. The turns go back whole so
   *  "shorter" means shorter than the last one. */
  const draft = (message?: string) => {
    if (!open) return;
    setErr('');
    setBusy('draft');
    const next = message ? [...turns, { role: 'user' as const, content: message }] : turns;
    // The hand-edited text is saved first so the model argues about what he
    // actually has in front of him, not the last thing it wrote.
    const save = edited !== (open.message ?? '') ? api.outreachUpdate(open.id, { message: edited }) : Promise.resolve();
    save
      .then(() => api.outreachDraft(open.id, next))
      .then(r => {
        setEdited(r.draft.message);
        setTurns([...next, { role: 'assistant', content: JSON.stringify(r.draft) }]);
        setSay('');
        return refresh();
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const add = () => {
    setErr('');
    setBusy('add');
    api
      .outreachCreate({
        name: draftNew.name,
        company: draftNew.company || null,
        segment: draftNew.segment || null,
        channel: draftNew.channel,
        handle: draftNew.handle || null,
        evidence: draftNew.evidence || null,
      })
      .then(r => {
        setAdding(false);
        setDraftNew({ name: '', company: '', segment: '', channel: 'x', handle: '', evidence: '' });
        return refresh().then(() => pick(r.prospect));
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const askIt = () => {
    const q = question.trim();
    if (!q) return;
    setErr('');
    setBusy('ask');
    const next = [...askTurns, { role: 'user' as const, content: q }];
    api
      .outreachAsk(next)
      .then(r => {
        setAskTurns([...next, { role: 'assistant', content: r.answer }]);
        setQuestion('');
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const n = words(edited);
  const sent = open ? Boolean(open.sentAt) : false;
  const waiting = prospects ? waitingFor(prospects) : [];

  const toggleLearnings = () => {
    const next = !learningsOpen;
    setLearningsOpen(next);
    if (next) {
      api
        .outreachGetLearnings()
        .then(r => setLearnings(r.learnings))
        .catch(e => setErr((e as Error).message));
    }
  };

  return (
    <section className="adm-block">
      <h2 className="pubws-h2">Outreach</h2>
      <p className="adm-note">
        The people you write to yourself. Each opens as what is known about them beside the message; argue with the
        draft, send it where they read, record what came back. Nothing here sends anything.
        {!configured ? ' Drafting is off: no drafting key is set.' : ''}
      </p>

      {prospects ? (
        <section className="ow-waiting" aria-label="Waiting for you">
          <h3 className="xw-h3">Waiting for you ({waiting.length})</h3>
          {waiting.length ? (
            waiting.map(item => <WaitingCard key={item.key} item={item} onDone={refresh} />)
          ) : (
            <p className="adm-sub">Nothing is waiting for you.</p>
          )}
        </section>
      ) : null}

      {summary ? (
        <div className="ow-summary adm-sub">
          {summary.enough ? (
            <>
              <span>
                {summary.sent} sent, {summary.replied} answered.
              </span>
              <table>
                <tbody>
                  {summary.bySegment.map(t => (
                    <tr key={`s-${t.key}`}>
                      <th>segment {t.key}</th>
                      <td>
                        {t.replied} of {t.sent}
                      </td>
                    </tr>
                  ))}
                  {summary.byChannel.map(t => (
                    <tr key={`c-${t.key}`}>
                      <th>{t.key}</th>
                      <td>
                        {t.replied} of {t.sent}
                      </td>
                    </tr>
                  ))}
                  {(summary.byVariant ?? []).map(t => (
                    <tr key={`v-${t.key}`}>
                      <th>variant {t.key}</th>
                      <td>
                        {t.replied} of {t.sent}
                      </td>
                    </tr>
                  ))}
                  {summary.features.map(f => (
                    <tr key={f.label}>
                      <th>{f.label}</th>
                      <td>
                        {Math.round(f.on * 100)}% vs {Math.round(f.off * 100)}% without
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <span>{summary.note}</span>
          )}
        </div>
      ) : null}

      <div className="xw-actions">
        <button className="adm-paygo" onClick={() => setAdding(a => !a)}>
          Add a prospect
        </button>
        <button className="adm-linkbtn" onClick={() => setLessonsOpen(o => !o)}>
          {lessonsOpen ? 'Hide lessons' : 'Lessons'}
        </button>
        <button className="adm-linkbtn" onClick={() => setAskOpen(o => !o)}>
          {askOpen ? 'Hide ask' : 'Ask it'}
        </button>
        <button className="adm-linkbtn" onClick={toggleLearnings} aria-expanded={learningsOpen}>
          Agent learnings
        </button>
      </div>

      {learningsOpen ? (
        <section className="xw-profile" aria-label="Agent learnings">
          <p className="adm-sub">What the overnight agent has learned from the record. It writes this, not you.</p>
          <p className="ow-evidence">{learnings === null ? 'Loading.' : learnings || 'Nothing learned yet.'}</p>
        </section>
      ) : null}

      {adding ? (
        <form
          className="ow-fields"
          onSubmit={e => {
            e.preventDefault();
            if (draftNew.name.trim()) add();
          }}
        >
          <input
            className="ow-field"
            placeholder="Name"
            value={draftNew.name}
            onChange={e => setDraftNew({ ...draftNew, name: e.target.value })}
          />
          <input
            className="ow-field"
            placeholder="Company or product"
            value={draftNew.company}
            onChange={e => setDraftNew({ ...draftNew, company: e.target.value })}
          />
          <input
            className="ow-field"
            placeholder="Segment"
            value={draftNew.segment}
            onChange={e => setDraftNew({ ...draftNew, segment: e.target.value })}
          />
          <select
            className="ow-field"
            value={draftNew.channel}
            onChange={e => setDraftNew({ ...draftNew, channel: e.target.value })}
            aria-label="Channel"
          >
            {CHANNELS.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="ow-field"
            placeholder="Their handle, address or URL"
            value={draftNew.handle}
            onChange={e => setDraftNew({ ...draftNew, handle: e.target.value })}
          />
          <textarea
            className="ow-evidence-edit"
            placeholder="Evidence: the verified facts, in their words, with sources. A draft quotes only this."
            value={draftNew.evidence}
            onChange={e => setDraftNew({ ...draftNew, evidence: e.target.value })}
          />
          <button className="adm-paygo" type="submit" disabled={busy === 'add' || !draftNew.name.trim()}>
            Add
          </button>
        </form>
      ) : null}

      {lessonsOpen && lessons !== null ? (
        <div className="xw-profile">
          <p className="adm-sub">What you have learned sending these, in your words. It reaches every draft.</p>
          <textarea value={lessons} onChange={e => setLessons(e.target.value)} rows={5} aria-label="Lessons" />
          <button
            className="adm-paygo"
            onClick={() => {
              setBusy('lessons');
              api
                .outreachSetLessons(lessons)
                .then(() => setNote('Lessons saved.'))
                .catch(e => setErr((e as Error).message))
                .finally(() => setBusy(''));
            }}
            disabled={busy === 'lessons'}
          >
            Save lessons
          </button>
        </div>
      ) : null}

      {askOpen ? (
        <div className="xw-draft">
          {askTurns.length ? (
            <ul className="adm-list xw-turns">
              {askTurns.map((t, i) => (
                <li key={i} className={t.role === 'user' ? 'adm-sub' : 'adm-sub xw-answer'}>
                  {t.role === 'user' ? `you: ${t.content}` : t.content}
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-sub">
              It answers from what you have sent and what came back, then from your lessons, and says which.
            </p>
          )}
          <form
            className="adm-payform"
            onSubmit={e => {
              e.preventDefault();
              askIt();
            }}
          >
            <input
              className="adm-payq"
              placeholder="Ask it: which segment to push, why that one got nothing, what to change?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
            />
            <button className="adm-paygo" type="submit" disabled={busy === 'ask' || !question.trim() || !configured}>
              {busy === 'ask' ? 'Thinking' : 'Send'}
            </button>
          </form>
        </div>
      ) : null}

      {err ? <p className="adm-err">{err}</p> : null}
      {note ? <p className="adm-sub">{note}</p> : null}

      <div className="ow-layout">
        <ul className="ow-list">
          {(prospects ?? []).map((p, i) => (
            <li key={p.id}>
              <button className="ow-row" onClick={() => pick(p)} aria-pressed={p.id === openId}>
                <span>
                  {i + 1}. {p.name}
                </span>
                <span className="adm-sub">
                  {p.day ? `${p.day} · ` : ''}
                  {p.status}
                </span>
              </button>
            </li>
          ))}
          {prospects && !prospects.length ? <li className="adm-sub">Nobody yet. Add a prospect above.</li> : null}
        </ul>

        {open ? (
          <div>
            <div className="adm-report-head">
              <strong>
                {open.name}
                {open.company ? `, ${open.company}` : ''}
              </strong>
              <span className="adm-sub">
                {open.segment ? `segment ${open.segment} · ` : ''}
                {open.channel}
                {open.handle ? ` ${open.handle}` : ''}
                {open.sentAt ? ` · sent ${open.sentAt.slice(0, 10)}` : ''}
              </span>
            </div>

            <p className="adm-sub">Evidence, the only facts a draft may use:</p>
            <textarea
              className="ow-evidence-edit"
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
              onBlur={() => {
                if (evidence !== (open.evidence ?? '')) patch(open.id, { evidence });
              }}
              aria-label="Evidence"
            />

            <div className="xw-actions">
              <button className="adm-paygo" onClick={() => draft()} disabled={busy === 'draft' || !configured}>
                {busy === 'draft' ? 'Thinking' : open.message ? 'Draft again' : 'Draft the message'}
              </button>
              <span className="ow-words" data-over={n > 75}>
                {n} words{n > 75 ? ', over 75' : ''}
              </span>
            </div>

            <div className="xw-draft">
              {turns.length ? (
                <ul className="adm-list xw-turns">
                  {turns.map((t, i) => (
                    <li key={i} className={t.role === 'user' ? 'adm-sub' : 'adm-sub xw-answer'}>
                      {t.role === 'user' ? `you: ${t.content}` : answerOf(t)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <textarea
                className="ow-message"
                value={edited}
                onChange={e => setEdited(e.target.value)}
                aria-label="The message you will send"
              />
              {/* Approving is the owner saying this exact text may go to this
                  exact person, and it is the only thing that authorises a
                  send, by him or by an agent working the approved rows
                  (docs/outreach-workbench.md, "Who actually sends"). It is
                  not a send and stamps nothing. */}
              <div className="xw-actions">
                {sent ? null : open.status === 'approved' ? (
                  <>
                    <strong className="ow-approved">Approved, waiting to be sent</strong>
                    <button
                      className="adm-linkbtn"
                      onClick={() => patch(open.id, { status: 'ready' }, 'Approval withdrawn.')}
                      disabled={busy === 'save'}
                    >
                      Unapprove
                    </button>
                  </>
                ) : (
                  <button
                    className="adm-paygo"
                    onClick={() => patch(open.id, { status: 'approved' }, 'Approved.')}
                    disabled={busy === 'save' || !edited.trim()}
                  >
                    Approve to send
                  </button>
                )}
              </div>

              <div className="xw-actions">
                {open.link ? (
                  <a className="adm-paygo" href={open.link} target="_blank" rel="noreferrer">
                    Open {open.channel}
                  </a>
                ) : (
                  <span className="adm-sub">No handle on file, so no link.</span>
                )}
                <button className="adm-paygo" onClick={() => copy(edited).then(() => setNote('Copied.'))}>
                  Copy
                </button>
                {sent ? (
                  <span className="adm-sub">Sent {open.sentAt?.slice(0, 10)}; the text that went out is frozen.</span>
                ) : (
                  <button
                    className="adm-paygo"
                    onClick={() => patch(open.id, { message: edited, status: 'sent' }, 'Recorded as sent.')}
                    disabled={busy === 'save' || !edited.trim()}
                  >
                    I sent this
                  </button>
                )}
                <button
                  className="adm-linkbtn"
                  onClick={() => {
                    if (edited !== (open.message ?? '')) patch(open.id, { message: edited }, 'Saved.');
                  }}
                  disabled={busy === 'save'}
                >
                  Save edit
                </button>
              </div>

              <form
                className="adm-payform"
                onSubmit={e => {
                  e.preventDefault();
                  if (say.trim()) draft(say.trim());
                }}
              >
                <input
                  className="adm-payq"
                  placeholder="Tell it what is wrong, or ask it something: shorter, drop the sale, why lead with that?"
                  value={say}
                  onChange={e => setSay(e.target.value)}
                />
                <button className="adm-paygo" type="submit" disabled={busy === 'draft' || !say.trim() || !configured}>
                  Push back
                </button>
              </form>
            </div>

            {open.thread?.length ? (
              <ul className="ow-thread" aria-label="Thread">
                {open.thread.map(m => (
                  <li key={m.id} className={m.direction === 'in' ? 'ow-in' : 'ow-out'}>
                    {m.direction === 'in' ? 'them: ' : `you, ${m.status}: `}
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="ow-fields">
              <select className="ow-field" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
                {STATUSES.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                className="ow-field"
                placeholder="What came back, in their words, or: no answer"
                value={outcome}
                onChange={e => setOutcome(e.target.value)}
                aria-label="What came back"
              />
              <button
                className="adm-paygo"
                onClick={() => patch(open.id, { status, outcome: outcome || null }, 'Outcome recorded.')}
                disabled={busy === 'save'}
              >
                Record outcome
              </button>
            </div>

            <div className="xw-actions">
              <code className="adm-sub">{open.logLine}</code>
              <button className="adm-linkbtn" onClick={() => copy(open.logLine).then(() => setNote('Copied.'))}>
                Copy log line
              </button>
              <button
                className="adm-linkbtn"
                onClick={() => {
                  if (!window.confirm(`Remove ${open.name}?`)) return;
                  api
                    .outreachDelete(open.id)
                    .then(() => {
                      setOpenId(null);
                      return refresh();
                    })
                    .catch(e => setErr((e as Error).message));
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <p className="adm-sub">Pick a prospect.</p>
        )}
      </div>
    </section>
  );
}
