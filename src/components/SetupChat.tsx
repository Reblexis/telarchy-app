import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Otto on the operator door (owner direction 2026-08-22).
 *
 * The screen this replaces was a form: name, number, ceiling, horizon. Every
 * one of those is a question Telarchy can answer better than a stranger on
 * their first minute, and a form cannot argue about the answer. Otto can, and
 * he ends the conversation by making the calls himself as them.
 *
 * Not the corner dock. On a floor Otto is an aside to the market; here he IS
 * the page, so he renders as the column's main body with no open/closed state
 * to discover.
 *
 * The link at the end comes from `opened`, which the server reads back from
 * the database. Nothing here trusts his prose for whether a floor exists: a
 * model that says "your floor is live" and is wrong would be worse than the
 * form it replaced.
 */

interface Turn { role: 'user' | 'assistant'; content: string }

const OPENERS = [
  'I run a company and I want its number priced',
  'What number should I put up?',
  'What does this cost me?',
];

export function SetupChat({ signedIn }: { signedIn: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<Array<{ name: string; slug: string | null }>>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);
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
      // Append rather than replace: a second number added later must not take
      // the first floor's door off the page.
      if (res.opened?.length) {
        setOpened(prev => [...prev, ...res.opened.filter(o => !prev.some(p => p.slug === o.slug))]);
      }
    } catch (e) {
      setError((e as Error).message || 'Otto is not answering right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="otto otto--page" aria-label="Otto, setting up your floor">
      <header className="otto-head">
        <span className="otto-mark" aria-hidden="true">O</span>
        <span className="otto-who">
          <strong>Otto</strong>
          <span className="otto-role">sets up floors</span>
        </span>
      </header>

      <div className="otto-log">
        {turns.length === 0 && (
          <>
            <p className="otto-msg otto-msg--otto">
              {signedIn
                ? `Tell me what you run and what it lives or dies on, and I will
                   pick the number worth putting up. If we agree on it I will open
                   the floor for you here, and give you the prompt to point your
                   own agent at it.`
                : `Tell me what you run and I will tell you which number is worth
                   putting up. I cannot open anything until you have an account,
                   and I will say so when we get there.`}
            </p>
            <div className="otto-openers">
              {OPENERS.map(o => (
                <button key={o} type="button" className="otto-opener" onClick={() => void send(o)}>
                  {o}
                </button>
              ))}
            </div>
          </>
        )}
        {turns.map((t, i) => (
          <p key={i} className={`otto-msg otto-msg--${t.role === 'user' ? 'you' : 'otto'}`}>
            {t.content}
          </p>
        ))}
        {busy && <p className="otto-msg otto-msg--otto is-thinking">…</p>}
        {error && <p className="ticket-err">{error}</p>}

        {/* The door to what was actually made. */}
        {opened.map(o => o.slug && (
          <p key={o.slug} className="otto-msg otto-msg--otto">
            <Link className="pubws-cta" to={`/${o.slug}`}>Go to {o.name}</Link>
          </p>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="otto-bar"
        onSubmit={e => { e.preventDefault(); void send(draft); }}
      >
        <input
          ref={inputRef}
          className="otto-input"
          value={draft}
          maxLength={1000}
          placeholder="What do you run?"
          onChange={e => setDraft(e.target.value)}
          aria-label="Tell Otto what you run"
        />
        {/* The same round glyph the dock uses: the word "Send" does not fit
            inside a 1.9rem circle and spilled out of it. */}
        <button className="otto-send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          ↑
        </button>
      </form>

      <p className="otto-note">
        {signedIn
          ? <>Otto acts with your account, so he can do what you can do and nothing more.</>
          : <><Link to="/signup?next=/manage">Create an account</Link> and he can open it for you. Signed out he can talk it through and create nothing.</>}
      </p>
    </section>
  );
}
