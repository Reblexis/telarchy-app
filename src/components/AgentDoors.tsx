import { useState } from 'react';
import {
  agentPrompt,
  type FloorRef,
  type KeyGrant,
  type OwnerFloorState,
  ownerAgentPrompt,
  traderAgentPrompt,
} from '../lib/agent-prompt';
import { api } from '../lib/api';

/**
 * The two doors on a market: ours and theirs.
 *
 * Otto is the first row, the visitor's own AI is the second, and they are one
 * hairline stack because they are the same offer made to two assistants
 * (docs/owner-on-the-floor.md, "Handing it to your own agent"). Rows, never a
 * card: the house keeps cards for the real interactive surfaces, the ticket
 * and the dialogs (docs/ui-conventions.md, "Hairlines, not cards").
 *
 * Neither row says "ask" once someone is signed in, because neither is only
 * answering: Otto trades, offers contracts and writes numbers as the person,
 * and so does their own agent once it holds a key (owner ask 2026-08-31). The
 * words change with what the reader may actually do, so a trader is offered
 * trading and a manager is offered running the thing.
 *
 * The order is load-bearing: permission first, then the prompt and the key
 * together, because the prompt says which permission it was given. A prompt
 * that has to guess what its key can do discovers the answer in 403s.
 */

const CHOICES: Array<{ id: KeyGrant; label: string; note: string; accent?: boolean }> = [
  { id: 'all', label: 'Everything I can do', note: 'every market I am in' },
  { id: 'here', label: 'Only this market', note: 'the usual choice', accent: true },
  { id: 'read', label: 'Read only', note: 'no trades, no changes' },
  { id: 'none', label: 'No key', note: 'public reading' },
];

function scopesFor(grant: KeyGrant): string[] {
  return grant === 'read' ? ['workspace:read', 'account:read'] : ['*'];
}

function copyText(value: string, mark: (v: boolean) => void) {
  navigator.clipboard
    .writeText(value)
    .then(() => {
      mark(true);
      setTimeout(() => mark(false), 1800);
    })
    .catch(e => console.error('copy failed:', e));
}

/** The chevron mark, the counterpart to Otto's O: their agent, not ours. */
function MineMark() {
  return (
    <span className="doors-mark doors-mark--mine" aria-hidden="true">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6l6 6-6 6" />
        <path d="M13 18h7" />
      </svg>
    </span>
  );
}

export function AgentDoors({
  floor,
  workspaceId,
  state,
  canManage,
  signedIn,
  onAskOtto,
  setupWords = false,
  className = '',
}: {
  floor: FloorRef;
  /** Null before the market payload lands; a key needs one to be pinned to. */
  workspaceId: string | null;
  /** The manager's view of the market, which is what their prompt is built from. */
  state: OwnerFloorState | null;
  canManage: boolean;
  signedIn: boolean;
  /** Opens Otto. Left out (in the Otto panel itself) the first row is dropped. */
  onAskOtto?: () => void;
  /** Day one on an empty market: the work on offer is the setup, not the running. */
  setupWords?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [grant, setGrant] = useState<KeyGrant | null>(null);
  const [busy, setBusy] = useState<KeyGrant | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [err, setErr] = useState('');

  const manager = canManage && state !== null;
  const ottoLabel = !signedIn
    ? `Ask Otto about ${floor.name}`
    : setupWords
      ? 'Have Otto set this market up with you'
      : manager
        ? 'Have Otto run this market with you'
        : 'Have Otto trade this market with you';
  const mineLabel = !signedIn
    ? 'Or read it from your own AI'
    : setupWords
      ? 'Or set it up from your own AI'
      : manager
        ? 'Or run it from your own AI'
        : 'Or trade it from your own AI';
  const note = !signedIn
    ? 'Otto can act for you once you have an account. The prompt reads the public brief and needs no key.'
    : manager
      ? 'Both act as you: numbers, dates, liquidity, contracts. Yours works on a key you choose.'
      : 'Otto places bets and offers contracts as you. Your own AI does the same, on a key you choose.';

  const promptFor = (g: KeyGrant): string =>
    manager && state
      ? ownerAgentPrompt(window.location.origin, state, g)
      : signedIn
        ? traderAgentPrompt(window.location.origin, floor, g, workspaceId)
        : agentPrompt(window.location.origin, floor);

  const take = async (g: KeyGrant) => {
    setErr('');
    if (g === 'none' || !workspaceId) {
      setGrant(g);
      return;
    }
    setBusy(g);
    try {
      const res = await api.mintAgentKey('me', {
        label: `${floor.name} · my own agent`,
        scopes: scopesFor(g),
        workspaceId,
        workspaceLocked: g === 'here',
      });
      setKey(res.apiKey);
      setGrant(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Signed out there is no key to choose and nothing to mint, so the row is
  // the whole interaction: it copies the reader prompt and says so.
  const mineOpens = () => {
    if (!signedIn) {
      copyText(promptFor('none'), setPromptCopied);
      return;
    }
    setOpen(v => !v);
  };

  const chosen = CHOICES.find(c => c.id === grant) ?? null;

  return (
    <div className={`doors ${className}`.trim()}>
      <div className="doors-stack">
        {onAskOtto && (
          <button type="button" className="doors-row" onClick={onAskOtto}>
            <span className="doors-mark doors-mark--otto" aria-hidden="true">
              O
            </span>
            <span className="doors-label">{ottoLabel}</span>
            <span className="doors-go" aria-hidden="true">
              →
            </span>
          </button>
        )}

        <button type="button" className={`doors-row${open ? ' is-open' : ''}`} onClick={mineOpens}>
          <MineMark />
          <span className="doors-label">{mineLabel}</span>
          {promptCopied ? (
            <span className="doors-said">Prompt copied</span>
          ) : chosen ? (
            <span className="doors-said doors-said--accent">{chosen.label.toLowerCase()}</span>
          ) : open ? (
            <span className="doors-said">what may it do as you?</span>
          ) : (
            <span className="doors-go" aria-hidden="true">
              →
            </span>
          )}
        </button>

        {open && !grant && (
          <>
            {CHOICES.map(c => (
              <button
                key={c.id}
                type="button"
                className="doors-opt"
                disabled={busy !== null}
                onClick={() => void take(c.id)}
              >
                <span className="doors-opt-name">{busy === c.id ? 'Minting…' : c.label}</span>
                <span className={`doors-opt-note${c.accent ? ' is-accent' : ''}`}>{c.note}</span>
              </button>
            ))}
          </>
        )}

        {open && grant && (
          <>
            {key && (
              <div className="doors-key">
                <code className="doors-key-value">{key}</code>
                <span className="doors-key-once">shown once</span>
              </div>
            )}
            <div className="doors-copies">
              <button type="button" className="doors-pill" onClick={() => copyText(promptFor(grant), setPromptCopied)}>
                {promptCopied ? 'Prompt copied' : 'Copy prompt'}
              </button>
              {key && (
                <button type="button" className="doors-pill" onClick={() => copyText(key, setKeyCopied)}>
                  {keyCopied ? 'Key copied' : 'Copy key'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {err && <p className="ticket-err">{err}</p>}
      <p className="doors-note">
        {open && grant
          ? 'The prompt says what the key may do, and to ask you before it spends credits or publishes.'
          : open
            ? 'A key acts as you, and can never do more than you can.'
            : note}
      </p>
    </div>
  );
}

/**
 * The key half on its own, for the operator door, where Otto has already
 * written the prompt beside the conversation and only the key is missing
 * (docs/otto.md).
 */
export function AgentKeyOffer({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [grant, setGrant] = useState<KeyGrant | null>(null);
  const [busy, setBusy] = useState<KeyGrant | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const take = async (g: KeyGrant) => {
    setErr('');
    if (g === 'none') {
      setGrant(g);
      return;
    }
    setBusy(g);
    try {
      const res = await api.mintAgentKey('me', {
        label: `${name} · my own agent`,
        scopes: scopesFor(g),
        workspaceId,
        workspaceLocked: g === 'here',
      });
      setKey(res.apiKey);
      setGrant(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (grant === 'none') return null;

  return (
    <div className="doors doors--offer">
      <div className="doors-stack">
        {!grant &&
          CHOICES.map(c => (
            <button
              key={c.id}
              type="button"
              className="doors-opt doors-opt--flush"
              disabled={busy !== null}
              onClick={() => void take(c.id)}
            >
              <span className="doors-opt-name">{busy === c.id ? 'Minting…' : c.label}</span>
              <span className={`doors-opt-note${c.accent ? ' is-accent' : ''}`}>{c.note}</span>
            </button>
          ))}
        {key && (
          <>
            <div className="doors-key doors-key--flush">
              <code className="doors-key-value">{key}</code>
              <span className="doors-key-once">shown once</span>
            </div>
            <div className="doors-copies doors-copies--flush">
              <button type="button" className="doors-pill" onClick={() => copyText(key, setCopied)}>
                {copied ? 'Key copied' : 'Copy key'}
              </button>
            </div>
          </>
        )}
      </div>
      {err && <p className="ticket-err">{err}</p>}
      <p className="doors-note">
        {key
          ? 'Send it as X-Agent-Key. We cannot show it again.'
          : 'A key lets the prompt act. It acts as you, and can never do more than you can.'}
      </p>
    </div>
  );
}
