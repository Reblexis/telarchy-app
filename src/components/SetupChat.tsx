import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { clearSetupDraft, loadSetupDraft, saveSetupDraft } from '../lib/setup-draft';
import { AgentKeyOffer } from './AgentDoors';
import { type InstrumentMarket, SetupInstrument, SetupTicks } from './SetupInstrument';

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

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** What people actually arrive wanting, in their words. */
const OPENERS = [
  'I run a company and I want its number priced',
  'Which number should I put up?',
  'What does this cost me?',
];

export function SetupChat({
  signedIn,
}: {
  /** null while the session check is still out. Claiming they have no account
   *  before asking is what made a signed-in visitor read the door as signed
   *  out (owner, 2026-08-24). */
  signedIn: boolean | null;
}) {
  // Picked up rather than started, when they left to make an account and came
  // back. Read once, at mount, so a draft saved in another tab cannot
  // overwrite a live conversation here.
  const [saved] = useState(() => loadSetupDraft());
  const [turns, setTurns] = useState<Turn[]>(() => saved?.turns ?? []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<Array<{ name: string; slug: string | null }>>([]);
  const [handoff, setHandoff] = useState(() => saved?.handoff ?? '');
  const [copied, setCopied] = useState(false);
  /** The prompt is being rewritten for the turn that just landed. */
  const [writing, setWriting] = useState(false);
  /** What the conversation has settled, sent back each turn so Otto does not
   *  re-ask. The server keeps only ids the specification knows. */
  const [settled, setSettled] = useState<string[]>(() => saved?.settled ?? []);
  const [checklist, setChecklist] = useState<{
    /** Present once a market exists; what a key can be pinned to. */
    workspace?: { id: string; name: string } | null;
    blocking: string[];
    market: InstrumentMarket | null;
    items: Array<{ id: string; label: string; status: 'done' | 'open'; note: string }>;
  } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, busy]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Kept on every turn, so leaving for the signup page (the one thing this
  // door asks of a visitor) costs them nothing. One effect owns both sides:
  // clearing imperatively when the market opened lost the race with this,
  // which re-saved on the very next render and offered a finished setup back
  // as if it were unfinished.
  useEffect(() => {
    if (opened.length) {
      clearSetupDraft();
      return;
    }
    saveSetupDraft({ turns, handoff, settled });
  }, [turns, handoff, settled, opened]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      // Otto's turn appears as he writes it. The empty assistant turn goes in
      // first so the words have somewhere to land, and the reader watches an
      // answer form instead of a dot for half a minute.
      setTurns([...next, { role: 'assistant', content: '' }]);
      const res = (await api.askSetupStream(next, settled, text => {
        setTurns(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + text };
          return copy;
        });
      })) as {
        answer: string;
        opened: Array<{ name: string; slug: string | null }>;
        checklist?: typeof checklist;
      };
      // The authoritative copy, in case a frame was lost on the way.
      const answered: Turn[] = [...next, { role: 'assistant', content: res.answer }];
      setTurns(answered);
      if (res.checklist) setChecklist(res.checklist);

      // The prompt for their own agent is a second model call, so it is asked
      // for AFTER the words are on screen rather than in front of them. It
      // updates the rail when it lands; a failure leaves the previous one up,
      // which is stale by one turn rather than absent.
      setWriting(true);
      api
        .askSetupHandoff(answered, settled)
        .then(h => {
          if (h.handoff) {
            setHandoff(h.handoff);
            setCopied(false);
          }
          if (h.settled?.length) setSettled(h.settled);
        })
        .catch(e => console.error('handoff failed:', e))
        .finally(() => setWriting(false));
      // Append rather than replace: a second number added later must not take
      // the first floor's door off the page.
      if (res.opened?.length) {
        setOpened(prev => [...prev, ...res.opened.filter(o => !prev.some(p => p.slug === o.slug))]);
      }
    } catch (e) {
      // Drop the half-written turn: a sentence that stops mid-word, left on
      // screen under an error, reads as something Otto said.
      setTurns(next);
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
      <section className="setup-talk" aria-label="Setting up your market with Otto">
        {turns.length === 0 ? (
          /* The hero is the instrument, unset. One statement, and it is the
             object they are about to make rather than a headline about it. */
          <div className="setup-open">
            <SetupInstrument market={null} />
            <p className="setup-sub">
              Say what you run. Otto picks the number worth putting up and opens the market for it.
            </p>
          </div>
        ) : (
          <>
            {/* Once they are talking it does not disappear, it shrinks and
                keeps filling in. That IS the progress bar. */}
            <div className="setup-head">
              <SetupInstrument market={checklist?.market ?? null} name={opened[0]?.name ?? null} compact />
              <SetupTicks items={checklist?.items ?? []} />
            </div>
            <div className="setup-log">
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <p className="setup-you" key={i}>
                    {t.content}
                  </p>
                ) : (
                  <p className="setup-otto" key={i}>
                    {t.content}
                  </p>
                ),
              )}
              {busy && (
                <span className="setup-thinking" aria-label="Otto is thinking">
                  <span />
                  <span />
                  <span />
                </span>
              )}
              {error && <p className="setup-err">{error}</p>}
              {/* The one fact among all the talk: a market that exists. */}
              {opened.map(
                o =>
                  o.slug && (
                    <Link className="setup-made" to={`/${o.slug}`} key={o.slug}>
                      {/* What the rows say, not what we hope. A market with no
                      number on it is not live, and saying so under a link the
                      reader is about to click is how they end up trusting the
                      label instead of the page (owner, 2026-08-24: the
                      receipt read LIVE over an address that answered "there
                      is no market at this address"). */}
                      <span className="setup-made-label">
                        {!checklist?.market
                          ? 'Opened, no number yet'
                          : checklist.market.consensus === null
                            ? 'Open, nothing behind it'
                            : 'Live'}
                      </span>
                      <span className="setup-made-name">{o.name}</span>
                      <span className="setup-made-at">telarchy.com/{o.slug}</span>
                    </Link>
                  ),
              )}
              <div ref={endRef} />
            </div>
          </>
        )}

        <form
          className="setup-composer"
          onSubmit={e => {
            e.preventDefault();
            void send(draft);
          }}
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
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
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
                  <span className="setup-suggestion-mark" aria-hidden="true">
                    ›
                  </span>
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && turns.length === 0 && <p className="setup-err">{error}</p>}

        <p className="setup-note">
          {signedIn === false ? (
            <>
              <Link to="/signup?next=/manage">Create an account</Link> and he can open the market right here. Signed
              out, he creates nothing.
            </>
          ) : signedIn === true ? (
            'Otto acts with your account and can do only what you can.'
          ) : null}
        </p>
      </section>

      {/* Rewritten every turn, so it is never behind the conversation. */}
      {/* The rail shows whatever it has. The floor's state is a database read
          and lands with the answer; the prompt is a model call and catches up,
          so gating the state on the prompt would hide the surer half behind
          the slower one. */}
      {(handoff || checklist) && (
        <aside className="setup-handoff" aria-label="Continue with your own agent">
          <div className="setup-handoff-head">
            {/* Short, because the button beside it must never wrap. */}
            <h2 className="setup-handoff-title">Your own agent</h2>
            <button
              type="button"
              className="setup-copy"
              onClick={() => void copyHandoff()}
              disabled={writing || !handoff}
            >
              {writing ? 'Rewriting' : copied ? 'Copied' : 'Copy prompt'}
            </button>
          </div>
          {handoff ? (
            <>
              <p className="setup-handoff-why">
                Paste this into the assistant that knows your business and it can finish the setup.
              </p>
              <pre className="setup-handoff-body">{handoff}</pre>
              {/* The prompt can read; a key is what lets it act. Offered here
                rather than carried inside the prompt, because a prompt gets
                pasted into logs and screenshots and a key must not
                (docs/owner-on-the-floor.md). Only once a market exists to
                pin it to. */}
              {checklist?.workspace?.id && (
                <AgentKeyOffer workspaceId={checklist.workspace.id} name={checklist.workspace.name} />
              )}
            </>
          ) : (
            <p className="setup-handoff-why">Otto is writing the prompt for your own agent.</p>
          )}

          {/* What the floor's own rows say, which is the thing a prompt cannot
              stay current about. */}
          {checklist && (
            <div className="setup-state">
              {checklist.blocking.map(b => (
                <p className="setup-blocking" key={b}>
                  {b}
                </p>
              ))}
              <ul className="setup-items">
                {checklist.items.map(i => (
                  <li key={i.id} className={`setup-item is-${i.status}`}>
                    <span className="setup-item-mark" aria-hidden="true">
                      {i.status === 'done' ? '·' : '○'}
                    </span>
                    <span className="setup-item-label">{i.label}</span>
                    <span className="setup-item-note">{i.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
