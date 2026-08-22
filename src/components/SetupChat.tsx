import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Otto on the operator door (owner direction 2026-08-22).
 *
 * Shaped like the assistants people already use: a greeting, one wide rounded
 * composer under it, and a short list of things to say. That shape was asked
 * for directly ("it should be similar to chatgpt design"), and it earns its
 * place here for a reason the rest of this design language does not cover:
 * everyone arriving at this page has typed into that exact rectangle before,
 * and none of them has to be taught what it is.
 *
 * Otto answers as plain prose across the column; the operator's own words sit
 * in a soft rounded block to the right. No avatars either side: two voices in
 * one column is all the structure a two-party conversation needs.
 *
 * Beside it, and the thing that makes this page more than a chat: the handoff.
 * Every turn, the server rebuilds a paste-ready prompt carrying the
 * conversation so far, what has actually been created, and the calls left to
 * make, so the operator can finish this with their own assistant, which knows
 * their business better than Otto ever will. It is assembled server-side, so
 * the ids in it are real (functions/src/lib/setup-handoff.ts).
 */

interface Turn { role: 'user' | 'assistant'; content: string }

/** What people actually arrive wanting, in their words. */
const OPENERS = [
  'I run a company and I want its number priced',
  'Which number should I put up?',
  'What does this cost me?',
];

export function SetupChat({ signedIn }: { signedIn: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<Array<{ name: string; slug: string | null }>>([]);
  const [handoff, setHandoff] = useState('');
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, busy]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const res = await api.askSetup(next);
      setTurns([...next, { role: 'assistant', content: res.answer }]);
      if (res.handoff) { setHandoff(res.handoff); setCopied(false); }
      // Append rather than replace: a second number added later must not take
      // the first floor's door off the page.
      if (res.opened?.length) {
        setOpened(prev => [...prev, ...res.opened.filter(o => !prev.some(p => p.slug === o.slug))]);
      }
    } catch (e) {
      setError((e as Error).message || 'Otto is not answering. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const copyHandoff = async () => {
    try {
      await navigator.clipboard.writeText(handoff);
      setCopied(true);
    } catch (e) {
      // Clipboard is refused in some contexts; the text is on the page and
      // selectable, so say nothing false about having copied it.
      console.error('clipboard write failed:', e);
      setError('Could not reach the clipboard. Select the prompt and copy it.');
    }
  };

  return (
    <div className={`setup${handoff ? ' setup--withhandoff' : ''}`}>
      <section className="setup-talk" aria-label="Setting up your floor with Otto">
        {turns.length === 0 ? (
          /* One greeting, which is also the page's title. The door used to
             carry a poster hero AND this, so a visitor met two headlines
             before the thing they came to type into. */
          <div className="setup-open">
            <h1 className="setup-greeting">Put your number up.</h1>
            <p className="setup-sub">
              Name the number you answer to, and anyone can offer a job that
              moves it. The market prices the job before you decide.
              {signedIn
                ? ' Tell Otto what you run and he will open the floor here.'
                : ' Tell Otto what you run and he will pick the number; opening it takes an account.'}
            </p>
          </div>
        ) : (
          <div className="setup-log">
            {turns.map((t, i) => (
              t.role === 'user'
                ? <p className="setup-you" key={i}>{t.content}</p>
                : <p className="setup-otto" key={i}>{t.content}</p>
            ))}
            {busy && <span className="setup-thinking" aria-label="Otto is thinking" />}
            {error && <p className="setup-err">{error}</p>}
            {/* The one fact among all the talk: a floor that exists. */}
            {opened.map(o => o.slug && (
              <Link className="setup-made" to={`/${o.slug}`} key={o.slug}>
                <span className="setup-made-label">Open</span>
                <span className="setup-made-name">{o.name}</span>
                <span className="setup-made-at">telarchy.com/{o.slug}</span>
              </Link>
            ))}
            <div ref={endRef} />
          </div>
        )}

        <form
          className="setup-composer"
          onSubmit={e => { e.preventDefault(); void send(draft); }}
        >
          <textarea
            ref={inputRef}
            className="setup-field"
            rows={1}
            value={draft}
            maxLength={1000}
            placeholder={turns.length ? 'Answer Otto' : 'Ask Otto'}
            aria-label="Tell Otto what you run"
            onChange={e => {
              setDraft(e.target.value);
              // Grow with the text, the way the field this borrows from does.
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
            }}
            onKeyDown={e => {
              // Enter sends, shift+Enter breaks the line: the convention every
              // assistant on the internet already taught them.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
            }}
          />
          <button className="setup-go" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            {busy ? <span className="setup-go-busy" aria-hidden="true" /> : '↑'}
          </button>
        </form>

        {turns.length === 0 && (
          <ul className="setup-suggest">
            {OPENERS.map(o => (
              <li key={o}>
                <button type="button" className="setup-suggestion" onClick={() => void send(o)}>
                  <span className="setup-suggestion-mark" aria-hidden="true">›</span>
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && turns.length === 0 && <p className="setup-err">{error}</p>}

        <p className="setup-note">
          {signedIn
            ? 'Otto acts with your account, so he can do what you can do and nothing more.'
            : <><Link to="/signup?next=/manage">Create an account</Link> and he can open the floor right here. Signed out he can talk it all the way through and create nothing.</>}
        </p>
      </section>

      {/* Rebuilt every turn, so it is never behind the conversation. */}
      {handoff && (
        <aside className="setup-handoff" aria-label="Continue with your own agent">
          <div className="setup-handoff-head">
            {/* Short, because the button beside it must never wrap. */}
            <h2 className="setup-handoff-title">Your own agent</h2>
            <button type="button" className="setup-copy" onClick={() => void copyHandoff()}>
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
          </div>
          <p className="setup-handoff-why">
            Everything said here, plus what has actually been created and the
            calls left to make. Your assistant knows your business better than
            Otto does.
          </p>
          <pre className="setup-handoff-body">{handoff}</pre>
        </aside>
      )}
    </div>
  );
}
