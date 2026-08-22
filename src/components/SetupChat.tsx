import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Otto on the operator door (owner direction 2026-08-22).
 *
 * A transcript, not a chat window. The first build reused the floor's corner
 * dock: a rounded card with a shadow, bubbles and a pill input. That is right
 * for an overlay hovering beside a market and wrong for a page, and it looked
 * borrowed, because it was (owner: "still the chat interface looks weird").
 * Everything else in this design language is hairlines, tiny tracked labels
 * and one column (docs/ui-conventions.md); a card with a drop shadow was the
 * one object on the page that came from somewhere else.
 *
 * So it is set as an interview record. Each turn is a row with the speaker in
 * the margin, in the house's tiny uppercase label, over a hairline. Otto's
 * words are in the display serif and the operator's in the body sans: the
 * house speaks in the house voice and you speak in yours, which separates the
 * two without a bubble, an avatar or a colour. The input is not a composer at
 * the bottom of a window; it is the next row of the transcript, with YOU
 * already in its margin and a rule under the words.
 *
 * The accent appears exactly once, on the receipt at the end, because that is
 * the only line on the page that is a fact rather than a conversation: a floor
 * exists, at an address. It is drawn from `opened`, which the server reads
 * back from the database, never from Otto's prose.
 */

interface Turn { role: 'user' | 'assistant'; content: string }

/** The three questions people actually arrive with, in their own words. They
 *  exist because a blank transcript is a blank page. */
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
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <section className="setup" aria-label="Setting up your floor with Otto">
      <div className="setup-turn">
        <span className="setup-who">Otto</span>
        <p className="setup-said setup-said--otto">
          {signedIn
            ? 'Tell me what you run and what it lives or dies on. I will pick the number worth putting up, open the floor for you here, and hand you the prompt that points your own agent at it.'
            : 'Tell me what you run and I will tell you which number is worth putting up. Opening it takes an account, and I will say so when we get there.'}
        </p>
      </div>

      {turns.length === 0 && (
        <div className="setup-turn">
          <span className="setup-who">Start with</span>
          <ul className="setup-openers">
            {OPENERS.map(o => (
              <li key={o}>
                <button type="button" className="setup-opener" onClick={() => void send(o)}>{o}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {turns.map((t, i) => (
        <div className="setup-turn" key={i}>
          <span className="setup-who">{t.role === 'user' ? 'You' : 'Otto'}</span>
          <p className={`setup-said setup-said--${t.role === 'user' ? 'you' : 'otto'}`}>{t.content}</p>
        </div>
      ))}

      {busy && (
        <div className="setup-turn" aria-live="polite">
          <span className="setup-who">Otto</span>
          {/* One rule, thinking. A row of bouncing dots would be the messenger
              app this page is deliberately not. */}
          <span className="setup-thinking" aria-label="Otto is thinking" />
        </div>
      )}

      {error && (
        <div className="setup-turn">
          <span className="setup-who">Failed</span>
          <p className="setup-said setup-said--err">{error}</p>
        </div>
      )}

      {/* The receipt: the one fact on this page, and the only accent on it. */}
      {opened.map(o => o.slug && (
        <div className="setup-made" key={o.slug}>
          <span className="setup-who">Open</span>
          <div>
            <p className="setup-made-name">{o.name}</p>
            <p className="setup-made-at">telarchy.com/{o.slug}</p>
            <Link className="setup-made-go" to={`/${o.slug}`}>Go to the floor</Link>
          </div>
        </div>
      ))}

      <form
        className="setup-turn setup-ask"
        onSubmit={e => { e.preventDefault(); void send(draft); }}
      >
        <label className="setup-who" htmlFor="setup-say">You</label>
        <span className="setup-line">
          <input
            ref={inputRef}
            id="setup-say"
            className="setup-input"
            value={draft}
            maxLength={1000}
            placeholder={turns.length ? 'Answer him' : 'What do you run?'}
            onChange={e => setDraft(e.target.value)}
            /* The visible label is the transcript's margin ("You"), which
               names the speaker rather than the field. A reader who cannot
               see the row needs the field's job instead. */
            aria-label="Tell Otto what you run" 
          />
          <button className="setup-send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">↑</button>
        </span>
      </form>

      <div ref={endRef} />

      <p className="setup-note">
        {signedIn
          ? 'Otto acts with your account, so he can do what you can do and nothing more.'
          : <><Link to="/signup?next=/manage">Create an account</Link> and he can open the floor right here. Signed out he can talk it all the way through and create nothing.</>}
      </p>
    </section>
  );
}
