import { useEffect, useRef, useState } from 'react';
import { type Access, accessForScopes, accessPresets, defaults, scopesForAccess } from '../lib/agent-builder';
import { type AgentKeyInfo, api } from '../lib/api';

import { AgentConnectionSetup } from './AgentConnectionSetup';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const scopesFor = (access: string) => scopesForAccess(access as Access);
function describeAccess(scopes: string[]) {
  if (scopes.includes('*')) return { name: 'Full access', detail: 'Can use every permission this account has.' };
  if (scopes.includes('workspace:manage'))
    return { name: 'Workspace management', detail: 'Can read, trade and manage workspaces.' };
  if (scopes.length === 0) return { name: 'No permissions', detail: 'This key has no API permissions.' };
  if (scopes.every(s => s === 'workspace:read' || s === 'workspace:trade')) {
    if (!scopes.includes('workspace:trade'))
      return { name: 'Research only', detail: 'Can read market data. Cannot trade or make changes.' };
    if (!scopes.includes('workspace:read'))
      return {
        name: 'Trading only',
        detail: 'Can place trades using this account’s credits. No market-reading permission.',
      };
    return { name: 'Research and trading', detail: 'Can read market data and trade using this account’s credits.' };
  }
  return {
    name: 'Custom permissions',
    detail: `Custom access: ${scopes.join(', ')}.`,
  };
}

/** The prompt embeds a key's permissions, so the runtime defaults to the widest current key, newest first. */
function preferredKey(keys: AgentKeyInfo[]): AgentKeyInfo {
  const newestFirst = [...keys].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return newestFirst.find(k => k.scopes.includes('*') && !k.workspaceLocked) || newestFirst[0];
}

/** Owner-only key controls use the same public API as external clients.
 * Mount separately for each signed-in account so secrets never cross sessions. */
export function AgentKeys({
  agentId,
  identity = 'bot',
  setupRequested = 0,
  runtimeOnly = false,
  showCreate = true,
  createRequested = 0,
}: {
  agentId: string;
  identity?: 'bot' | 'me';
  setupRequested?: number;
  runtimeOnly?: boolean;
  showCreate?: boolean;
  /** Bumped by the section heading's New key action; opens the form once per bump. */
  createRequested?: number;
}) {
  const [keys, setKeys] = useState<AgentKeyInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState('keep');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAccess, setNewAccess] = useState('read');
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const openedSetup = useRef(0);
  useEffect(() => {
    if (createRequested > 0) setCreating(true);
  }, [createRequested]);
  useEffect(() => {
    if (!setupRequested || setupRequested === openedSetup.current || !keys) return;
    openedSetup.current = setupRequested;
    if (keys.length) setRuntime(preferredKey(keys).keyId);
    else setCreating(true);
  }, [setupRequested, keys]);
  const live = useRef(true);
  const lock = useRef(false);
  const version = useRef(0);
  const load = async () => {
    const v = ++version.current;
    const rows = await api.listAgentKeys(agentId);
    if (live.current && v === version.current) setKeys(rows);
  };
  useEffect(() => {
    live.current = true;
    void load().catch(e => {
      if (live.current) setError(message(e));
    });
    return () => {
      live.current = false;
      version.current++;
    };
  }, [agentId]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await api.updateAgentKey(agentId, editing!, {
        label: label.trim() || null,
        ...(access === 'keep'
          ? {}
          : {
              scopes: scopesFor(access),
              ...(access === 'full' || access === 'manage' ? { workspaceLocked: false } : {}),
            }),
      });
      if (!live.current) return;
      setEditing(null);
      await load();
    });
  const revoke = () =>
    run(async () => {
      await api.revokeAgentKey(agentId, confirm!);
      if (!live.current) return;
      setConfirm(null);
      await load();
    });
  const mint = () =>
    run(async () => {
      if (uncertain) return;
      const home = (await api.getPublicWorkspaces()).find(w => w.slug === 'telarchy');
      if (!home) throw new Error('Setup is temporarily unavailable. Try again.');
      if (!live.current) return;
      let made;
      try {
        made = await api.mintAgentKey(agentId, {
          label: newLabel.trim() || 'Trading agent',
          scopes: identity === 'bot' ? ['*'] : scopesFor(newAccess),
          workspaceId: home.workspaceId,
          workspaceLocked: identity === 'me' && (newAccess === 'read' || newAccess === 'trade'),
        });
      } catch (e) {
        if (live.current) setUncertain(true);
        throw e;
      }
      if (!live.current) return;
      setSecret(made.apiKey);
      setCopied(false);
      setCreating(false);
      await load();
    });
  if (runtimeOnly && keys?.length) {
    const selected = keys.find(k => k.keyId === runtime) || preferredKey(keys);
    const selectedAccess =
      identity === 'bot'
        ? selected.scopes.includes('*') && !selected.workspaceLocked
          ? 'Full bot access'
          : 'Restricted key'
        : describeAccess(selected.scopes).name;
    return (
      <div className="agent-keys agent-runtime-panel">
        {keys.length > 1 && (
          <label className="agent-runtime-key">
            Use key
            <select aria-label="Use key" value={selected.keyId} onChange={e => setRuntime(e.target.value)}>
              {keys.map(k => (
                <option key={k.keyId} value={k.keyId}>
                  {k.label || 'Unnamed key'}
                </option>
              ))}
            </select>
            <span className="agent-key-access">{selectedAccess}</span>
          </label>
        )}
        <AgentConnectionSetup
          agentId={agentId}
          options={{
            ...defaults,
            identity,
            workspace: selected.workspaceId || 'telarchy',
            access: accessForScopes(selected.scopes),
          }}
        />
      </div>
    );
  }
  return (
    <div className="agent-keys">
      {error && <p role="alert">{error}</p>}
      <div className="agent-manage-actions">
        {(uncertain || (!keys && error)) && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load();
                if (live.current) setUncertain(false);
              })
            }
          >
            {uncertain ? 'Check creation status' : 'Try loading again'}
          </button>
        )}
        {showCreate && (
          <button
            type="button"
            disabled={busy || uncertain}
            onClick={() => {
              setCreating(c => !c);
            }}
          >
            {creating ? 'Cancel new key' : 'Create key'}
          </button>
        )}
      </div>
      {uncertain && (
        <p role="alert">
          The result is uncertain. Check creation status and review the list before trying again. Its secret cannot be
          recovered; revoke an unused key if needed.
        </p>
      )}
      {creating && (
        <div className="agent-manage-form">
          <label>
            New key label
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              disabled={busy}
              placeholder="My laptop"
            />
          </label>
          {identity === 'me' && (
            <label>
              New key permissions
              <select value={newAccess} onChange={e => setNewAccess(e.target.value)} disabled={busy}>
                {accessPresets.map(p => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="agent-manage-hint">
            {identity === 'bot' ? 'Full access to this bot.' : accessPresets.find(p => p.value === newAccess)?.detail}
          </p>
          <div className="agent-manage-actions">
            <button type="button" disabled={busy || uncertain} onClick={() => void mint()}>
              {identity === 'bot' ? 'Create bot key' : 'Create account key'}
            </button>
            {!showCreate && (
              <button type="button" disabled={busy} onClick={() => setCreating(false)} aria-label="Cancel new key">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {secret && (
        <div className="agent-new-key">
          <p>Shown once. Save this key in your runtime before dismissing it.</p>
          <code>{secret}</code>
          <div className="agent-manage-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => {
                    if (live.current) setCopied(true);
                  })
                  .catch(() => {
                    if (live.current) setError('Copy failed. Select the key and copy it manually.');
                  });
              }}
            >
              {copied ? 'Key copied' : 'Copy key'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSecret(null);
                setCopied(false);
              }}
            >
              Dismiss key
            </button>
          </div>
        </div>
      )}
      {!keys ? (
        <p>{error ? 'Keys could not be loaded.' : 'Loading keys…'}</p>
      ) : keys.length === 0 ? (
        <p>No keys yet.</p>
      ) : (
        <ul className="agent-key-list">
          {keys.map(k => (
            <li key={k.keyId}>
              <div className="agent-key-heading">
                <strong>{k.label || 'Unnamed key'}</strong>
                <span
                  className="agent-key-access"
                  title={
                    identity === 'bot'
                      ? k.scopes.includes('*') && !k.workspaceLocked
                        ? 'Can do everything this bot can.'
                        : 'An older key with narrower access than a new bot key.'
                      : describeAccess(k.scopes).detail
                  }
                >
                  {identity === 'bot'
                    ? k.scopes.includes('*') && !k.workspaceLocked
                      ? 'Full bot access'
                      : 'Restricted key'
                    : describeAccess(k.scopes).name}
                </span>
              </div>
              <p className="agent-key-used">
                {k.lastUsedAt
                  ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'Not used yet'}
              </p>
              {runtime === k.keyId && (
                <AgentConnectionSetup
                  agentId={agentId}
                  options={{
                    ...defaults,
                    workspace: k.workspaceId || 'telarchy',
                    identity,
                    access: accessForScopes(k.scopes),
                  }}
                />
              )}
              <div className="agent-manage-actions">
                {identity === 'me' && (
                  <button
                    type="button"
                    aria-label={`Run ${k.label || 'key'}`}
                    aria-expanded={runtime === k.keyId}
                    onClick={() => setRuntime(runtime === k.keyId ? null : k.keyId)}
                  >
                    {runtime === k.keyId ? 'Close' : 'Run'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Edit ${k.label || 'key'}`}
                  onClick={() => {
                    setEditing(k.keyId);
                    setLabel(k.label || '');
                    setAccess('keep');
                    setConfirm(null);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Revoke ${k.label || 'key'}`}
                  onClick={() => {
                    setConfirm(k.keyId);
                    setEditing(null);
                  }}
                >
                  Revoke
                </button>
              </div>
              {editing === k.keyId && (
                <div className="agent-manage-form">
                  <label>
                    Key label
                    <input value={label} onChange={e => setLabel(e.target.value)} disabled={busy} />
                  </label>
                  {identity === 'me' && (
                    <label>
                      Key permissions
                      <select value={access} onChange={e => setAccess(e.target.value)} disabled={busy}>
                        <option value="keep">Keep current permissions</option>
                        {accessPresets.map(p => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {identity === 'me' && access !== 'keep' && (
                    <p className="agent-manage-hint">{accessPresets.find(p => p.value === access)?.detail}</p>
                  )}
                  <div className="agent-manage-actions">
                    <button type="button" disabled={busy} onClick={() => void save()}>
                      Save key
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                      Cancel edit
                    </button>
                  </div>
                </div>
              )}
              {confirm === k.keyId && (
                <div className="agent-manage-confirm">
                  <p>Revoke {k.label || 'this key'}? Software using it will lose access immediately.</p>
                  <button type="button" disabled={busy} onClick={() => void revoke()}>
                    Confirm revoke
                  </button>{' '}
                  <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                    Keep key
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
