import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Otto, in the corner (owner direction 2026-08-20: "make it more of a chat,
 * maybe bottom right, just a guy with personality").
 *
 * He is the floor's market maker and, since 2026-08-21, the visitor's hands on
 * Telarchy: he calls the API with THEIR account, so he can do whatever they
 * can do and nothing else (functions/src/services/otto-tools.ts). Signed out
 * he can still read everything public, which is what the copy below says
 * rather than offering an action that would come back 401.
 *
 * The friction he removes is specific. A visitor looking at "the market says
 * 25" has no way to judge whether 25 is right without knowing what the company
 * sells, how the number is measured and what has already been priced. That
 * knowledge exists, spread across a chart, a definition, a charter, eight
 * contracts and the owner's data room, and reading all of it is more work than
 * the bet is worth. Asking someone is not.
 *
 * A named character rather than a neutral answer box, because the answer a
 * visitor actually wants is "what would you do", and no answer service says
 * that. He is allowed opinions and advice; he is not allowed to invent a
 * number (functions/src/lib/ask.ts holds that contract).
 *
 * In the corner rather than in the column: the page's job is the market, and
 * the reader who needs him needs him at any point in the page, not at one
 * scroll position. Closed he is one line; open he is a panel that does not
 * cover the instrument on a laptop and takes the whole sheet on a phone.
 */

interface Props {
  idOrSlug: string;
  workspaceName: string;
  /** Whether the visitor has an account, which decides whether Otto can act
   *  for them or only read. The backend decides the same thing from their
   *  credentials; this only picks the honest words. */
  signedIn: boolean;
  /** The number the floor leads with, used for one opening suggestion. */
  metricLabel: string | null;
  /** What the corner says. Otto acts as whoever is signed in, so the dock
   *  says the work rather than "ask" (docs/ui-conventions.md, "An assistant
   *  row says what it DOES"). */
  dockLabel?: string;
  /** "Continue with your own agent": the same handoff the page shows under
   *  Ask Otto, rendered inside the conversation so leaving for your own agent
   *  never means starting again (docs/otto.md). */
  handoff?: ReactNode;
  /** Open state, when the page owns it. The floor does, because the
   *  "Ask Otto" button beside "What is <name>?" opens this same panel: two
   *  doors into one conversation, never a second Otto. Left out, he keeps
   *  his own state and the dock is the only way in. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function FloorChat({
  idOrSlug,
  workspaceName,
  metricLabel,
  signedIn,
  dockLabel,
  handoff,
  open: openProp,
  onOpenChange,
}: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Openers, because a blank chat is a blank page and a blank page is
  // friction of its own. They name this floor's own subjects.
  const openers = [
    `What does ${workspaceName} actually do?`,
    metricLabel ? `Is ${metricLabel.toLowerCase()} priced right?` : 'Is this market priced right?',
    // The third opener says what changed: signed in, he does things.
    signedIn ? 'What am I holding, and what is it worth?' : 'Which contract would you take?',
  ];

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, open, busy]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    // The whole conversation goes with every turn, which is what makes a
    // follow-up mean anything; the server keeps the last twelve.
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const res = await api.askFloor(idOrSlug, next);
      setTurns([...next, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setError((e as Error).message || 'Otto is not answering right now.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="ottodock" onClick={() => setOpen(true)}>
        <span className="ottodock-mark" aria-hidden="true">
          O
        </span>
        <span className="ottodock-label">{dockLabel ?? `Ask Otto about ${workspaceName}`}</span>
      </button>
    );
  }

  return (
    <section className="otto" aria-label={`Otto, the market maker on ${workspaceName}`}>
      <header className="otto-head">
        <span className="otto-mark" aria-hidden="true">
          O
        </span>
        <span className="otto-who">
          <strong>Otto</strong>
          <span className="otto-role">market maker on {workspaceName}</span>
        </span>
        <button type="button" className="otto-close" aria-label="Close" onClick={() => setOpen(false)}>
          ×
        </button>
      </header>

      <div className="otto-log">
        {turns.length === 0 && (
          <>
            <p className="otto-msg otto-msg--otto">
              {signedIn
                ? 'I watch this floor. Ask what the company does or where the price should be, and I can act for you: place a bet, offer a contract, tell you what you hold.'
                : 'I watch this floor. Ask what the company does, whether the price looks right, or which contract I would take.'}
            </p>
            <div className="otto-openers">
              {openers.map(o => (
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
        {busy && <p className="otto-msg otto-msg--otto is-thinking">Reading the book…</p>}
        {error && <p className="ticket-err">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="otto-bar"
        onSubmit={e => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          ref={inputRef}
          className="otto-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Ask Otto"
          maxLength={500}
          aria-label="Ask Otto"
        />
        <button className="otto-send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          ↑
        </button>
      </form>
      {/* Otto is never a dead end (owner ask 2026-08-31): the same work, in
        the agent they already talk to, carrying what this conversation has
        established. docs/otto.md, "Continue with your own agent". */}
      {handoff && <div className="otto-handoff">{handoff}</div>}
      <p className="otto-note">
        {signedIn ? (
          <>
            Otto acts with your account and can do only what you can. His opinions are not advice from {workspaceName}.
          </>
        ) : (
          <>Otto&rsquo;s opinions are not advice from {workspaceName}. Sign up and he can act for you too.</>
        )}
      </p>
    </section>
  );
}
