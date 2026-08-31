import { useState } from 'react';
import { agentPrompt, type FloorRef, type OwnerFloorState, ownerAgentPrompt } from '../lib/agent-prompt';
import { api } from '../lib/api';

/**
 * "Copy a prompt for your own AI", under Ask Otto and under the empty
 * market's own button (docs/owner-on-the-floor.md, "Handing it to your own
 * agent").
 *
 * The order is the whole design: the prompt first, the key second, and the
 * key never inside the prompt. A prompt gets pasted into chat logs, issues
 * and screenshots; a key that travelled with it would be in all three.
 *
 * The four choices are the operator's own reach, sliced: everything they can
 * do, the same thing pinned to this market, read-only, or nothing at all.
 * None can exceed them, because an agent key acts AS its owner and the
 * server intersects its scopes with what their groups already allow
 * (docs/guides/auth-and-keys.md).
 */

type Choice = 'all' | 'here' | 'read' | 'none';

function copyText(value: string, mark: (v: boolean) => void) {
  navigator.clipboard
    .writeText(value)
    .then(() => {
      mark(true);
      setTimeout(() => mark(false), 1800);
    })
    .catch(e => console.error('copy failed:', e));
}

const CHOICES: Array<{ id: Choice; label: string; hint: string }> = [
  { id: 'all', label: 'Everything I can do', hint: 'every market I am in' },
  { id: 'here', label: 'Only on this market', hint: 'same powers, one market' },
  { id: 'read', label: 'Read only', hint: 'no actions at all' },
  { id: 'none', label: 'No key', hint: 'public reading only' },
];

function scopesFor(choice: Choice): string[] {
  return choice === 'read' ? ['workspace:read', 'account:read'] : ['*'];
}

/**
 * The key half, on its own because two surfaces offer it: the market page
 * after the prompt is copied, and the operator door beside the prompt Otto
 * wrote.
 */
export function AgentKeyOffer({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [busy, setBusy] = useState<Choice | null>(null);
  const [key, setKey] = useState<{ raw: string; choice: Choice } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [err, setErr] = useState('');

  const take = async (choice: Choice) => {
    if (choice === 'none') {
      setDismissed(true);
      return;
    }
    setBusy(choice);
    setErr('');
    try {
      const res = await api.mintAgentKey('me', {
        label: `${name} · my own agent`,
        scopes: scopesFor(choice),
        workspaceId,
        workspaceLocked: choice === 'here',
      });
      setKey({ raw: res.apiKey, choice });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (dismissed) return null;

  if (key) {
    return (
      <div className="handoff-keys">
        <p className="handoff-keys-head">Your key, shown once</p>
        <code className="handoff-key-value">{key.raw}</code>
        <button
          type="button"
          className="handoff-key-copy"
          onClick={() => {
            copyText(key.raw, setCopied);
          }}
        >
          {copied ? 'Copied' : 'Copy key'}
        </button>
        <p className="handoff-note">
          Send it as the header <code>X-Agent-Key</code>, with <code>X-Workspace-Id: {workspaceId}</code>.
          {key.choice === 'here'
            ? ' It works on this market and nowhere else.'
            : key.choice === 'read'
              ? ' It can read what you can read and change nothing.'
              : ' It can do anything you can, on every market you are in.'}{' '}
          We cannot show it again; lose it and mint another.
        </p>
      </div>
    );
  }

  return (
    <div className="handoff-keys">
      <p className="handoff-keys-head">What may it do as you?</p>
      {CHOICES.map(c => (
        <button
          key={c.id}
          type="button"
          className="handoff-key-opt"
          disabled={busy !== null}
          onClick={() => void take(c.id)}
        >
          <span className="handoff-key-label">{busy === c.id ? 'Minting…' : c.label}</span>
          <span className="handoff-key-hint">{c.hint}</span>
        </button>
      ))}
      <p className="handoff-note">
        A key acts as you and can never do more than you can. Nothing here can change your password or move your money
        out.
      </p>
      {err && <p className="ticket-err">{err}</p>}
    </div>
  );
}

export function AgentHandoff({
  floor,
  state,
  canManage,
  signedIn,
  label = 'Copy a prompt for your own AI',
  className = '',
}: {
  /** For the reader prompt, which is what a visitor gets. */
  floor: FloorRef;
  /** The market's real state; absent until it loads, or for a visitor. */
  state: OwnerFloorState | null;
  canManage: boolean;
  signedIn: boolean;
  /** Inside an Otto conversation this reads "Continue with your own agent",
   *  because that is what it is there: the same work, in the assistant they
   *  already use (docs/otto.md). */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [offering, setOffering] = useState(false);

  const owner = canManage && state !== null;
  const text = owner ? ownerAgentPrompt(window.location.origin, state) : agentPrompt(window.location.origin, floor);

  return (
    <div className={`handoff ${className}`.trim()}>
      <button
        type="button"
        className="handoff-go"
        onClick={() => {
          copyText(text, setCopied);
          // The key offer only makes sense for someone who could act: a
          // visitor's prompt reads public data and needs nothing.
          if (owner && signedIn) setOffering(true);
        }}
      >
        {copied ? 'Prompt copied' : label}
      </button>
      <span className="handoff-sub">
        {owner
          ? 'It knows this market, what is missing, and the calls. Paste it into Claude Code, Cursor or whatever you use.'
          : 'It points your AI at the public brief for this market: every number, what the market predicts, every contract.'}
      </span>
      {offering && state && <AgentKeyOffer workspaceId={state.workspaceId} name={state.name} />}
    </div>
  );
}
