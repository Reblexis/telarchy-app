import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import {
  ALL_KEY_SCOPES,
  ACCOUNT_SCOPES,
  WORKSPACE_SCOPES,
  SCOPE_LABELS,
  SCOPE_PRESETS,
  type AgentApiKey,
  type CreatedAgent,
  type MintedApiKey,
  type PermissionGroup,
  type ScopeValue,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface MyAgentRow {
  id: string;
  authUserId: string | null;
  ownerUserId: string | null;
  nickname: string | null;
  balance: number;
}

interface WorkspaceListing {
  id: string;
  name: string;
  /** legacy memberRole label; capabilities[] is authoritative for what the user can do */
  memberRole: string;
}

/** Workspaces the caller owns/admins. Derived from /api/auth/me's workspaces map.
 *  We surface only those because that's where the caller can add a new agent. */
function useManageableWorkspaces(): { workspaces: WorkspaceListing[]; loading: boolean } {
  const [workspaces, setWorkspaces] = useState<WorkspaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    api.listWorkspaces()
      .then((rows: unknown) => {
        if (cancel) return;
        const list = (rows as Array<{ id: string; name: string; memberRole?: string }> | null) ?? [];
        setWorkspaces(list.map(w => ({ id: w.id, name: w.name, memberRole: w.memberRole ?? '' })));
      })
      .catch(err => console.error('Failed to load workspaces for API page', err))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);
  return { workspaces, loading };
}

function relTime(iso: string | null): string {
  if (!iso) return 'never used';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function ScopeChip({ scope }: { scope: string }) {
  const meta = scope === '*' ? null : SCOPE_LABELS[scope as keyof typeof SCOPE_LABELS];
  const tooltip = scope === '*'
    ? 'Wildcard. Full access; equivalent to a legacy unrestricted key.'
    : meta?.help ?? scope;
  return (
    <span
      className="agent-chip agent-chip-custom"
      title={tooltip}
      style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
    >
      {scope}
    </span>
  );
}

function ScopePicker({
  value,
  onChange,
  bound,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Optional upper bound: scopes the caller can grant. Other scopes are
   *  rendered disabled. Pass undefined for browser-session callers (no bound). */
  bound?: string[];
}) {
  const isWildcardBound = !bound || bound.includes('*');
  const allowed = useMemo(() => isWildcardBound ? new Set<string>(ALL_KEY_SCOPES) : new Set(bound), [bound, isWildcardBound]);

  const wildcardSelected = value.includes('*');
  const selected = useMemo(() => new Set(value), [value]);
  const [presetId, setPresetId] = useState<string>(() => {
    const match = SCOPE_PRESETS.find(p => p.scopes.length === value.length && p.scopes.every(s => selected.has(s)));
    return match?.id ?? 'custom';
  });

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (id === 'custom') return;
    const preset = SCOPE_PRESETS.find(p => p.id === id);
    if (preset) onChange(preset.scopes.slice());
  };

  const toggle = (scope: string) => {
    setPresetId('custom');
    if (selected.has(scope)) {
      onChange(value.filter(s => s !== scope));
    } else {
      onChange([...value, scope]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {SCOPE_PRESETS.map(p => {
          const isSelected = presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              title={p.description}
              className={`btn-small${isSelected ? ' selected' : ''}`}
              style={{
                fontWeight: isSelected ? 600 : 400,
                background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                border: '1px solid var(--border-color)',
              }}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setPresetId('custom')}
          className={`btn-small${presetId === 'custom' ? ' selected' : ''}`}
          style={{
            fontWeight: presetId === 'custom' ? 600 : 400,
            background: presetId === 'custom' ? 'var(--bg-tertiary)' : 'transparent',
            border: '1px solid var(--border-color)',
          }}
        >
          Custom…
        </button>
      </div>

      {(presetId === 'custom' || presetId === 'full') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {wildcardSelected ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
              Wildcard <code>*</code> is selected. Uncheck the Full preset to choose individual scopes.
            </p>
          ) : (
            <>
              {(['Workspace', 'Account'] as const).map(group => {
                const groupScopes = group === 'Workspace' ? WORKSPACE_SCOPES : ACCOUNT_SCOPES;
                return (
                  <div key={group}>
                    <div className="section-label" style={{ marginBottom: '0.3rem' }}>{group}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {groupScopes.map(scope => {
                        const checked = selected.has(scope);
                        const grantable = allowed.has(scope);
                        return (
                          <label key={scope} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: grantable ? 'pointer' : 'not-allowed', opacity: grantable ? 1 : 0.5 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!grantable}
                              onChange={() => toggle(scope)}
                              style={{ marginTop: '0.2rem' }}
                            />
                            <span>
                              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{scope}</span>
                              <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem', fontSize: '0.78rem' }}>
                                {SCOPE_LABELS[scope].label}
                              </span>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                                {SCOPE_LABELS[scope].help}
                                {!grantable && ' (not in your key’s scopes)'}
                              </div>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NewKeyDisclosure({ minted, onClose }: { minted: MintedApiKey; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="section" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--focus-border)', marginTop: '1rem' }}>
      <div className="section-label">New API key (shown once)</div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
        Copy this key now. It won’t be shown again. Store it like a password.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
        <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.5rem 0.6rem', background: 'var(--bg-tertiary)', borderRadius: 4, overflowX: 'auto' }}>
          {minted.apiKey}
        </code>
        <button
          type="button"
          className="btn-small"
          onClick={() => { navigator.clipboard.writeText(minted.apiKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        {(minted.scopes ?? []).map(s => <ScopeChip key={s} scope={s} />)}
        {minted.label && <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>· {minted.label}</span>}
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <button type="button" className="btn-small" onClick={onClose}>I’ve saved it</button>
      </div>
    </div>
  );
}

function KeysList({
  agentId,
  currentKeyId,
  callerScopes,
  onMintedSomething,
}: {
  agentId: string;
  currentKeyId: string | null;
  callerScopes: string[] | undefined;
  onMintedSomething: () => void;
}) {
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showMint, setShowMint] = useState(false);
  const [mintLabel, setMintLabel] = useState('');
  const [mintScopes, setMintScopes] = useState<string[]>(SCOPE_PRESETS[0].scopes.slice());
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedApiKey | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listAgentKeys(agentId) as AgentApiKey[];
      setKeys(rows ?? []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { reload(); }, [reload]);

  const handleMint = async (e: FormEvent) => {
    e.preventDefault();
    setMinting(true);
    setError('');
    try {
      const res = await api.mintAgentKey(agentId, { label: mintLabel.trim() || undefined, scopes: mintScopes }) as MintedApiKey;
      setMinted(res);
      setShowMint(false);
      setMintLabel('');
      setMintScopes(SCOPE_PRESETS[0].scopes.slice());
      onMintedSomething();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMinting(false);
    }
  };

  const handleRevoke = async (key: AgentApiKey) => {
    if (currentKeyId === key.keyId) {
      alert('You can\'t revoke the key authorizing this session. Mint a new key first, switch to it, and revoke this one from there.');
      return;
    }
    const lastWarn = keys.length === 1 ? '\n\nThis is the only key on this agent. Revoking it removes all programmatic access for the agent.' : '';
    if (!confirm(`Revoke key ${key.label || key.hashPrefix}?${lastWarn}`)) return;
    try {
      await api.revokeAgentKey(agentId, key.keyId);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      {error && <div className="message error show" style={{ marginBottom: '0.5rem' }}>{error}</div>}
      {loading ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loading…</p>
      ) : keys.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No keys yet. Mint one to call the API as this participant from a script.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {keys.map(k => (
            <div key={k.keyId} className="api-key-row" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.6rem 0', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{k.label || <em style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>unlabeled</em>}</strong>
                  <code style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{k.hashPrefix}…</code>
                  {currentKeyId === k.keyId && (
                    <span className="agent-chip agent-chip-trader" style={{ fontSize: '0.7rem' }}>this session</span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  Created {relTime(k.createdAt)} · Last used {relTime(k.lastUsedAt)}
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                  {k.scopes.map(s => <ScopeChip key={s} scope={s} />)}
                </div>
              </div>
              <button type="button" className="btn-small btn-delete" onClick={() => handleRevoke(k)}>Revoke</button>
            </div>
          ))}
        </div>
      )}

      {!showMint ? (
        <div style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn-small" onClick={() => setShowMint(true)}>Mint new key</button>
        </div>
      ) : (
        <form onSubmit={handleMint} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label htmlFor={`label-${agentId}`} className="section-label" style={{ display: 'block', marginBottom: '0.3rem' }}>Label (optional)</label>
            <input id={`label-${agentId}`} type="text" value={mintLabel} onChange={e => setMintLabel(e.target.value)} placeholder='e.g. "anchor bot prod"' style={{ marginBottom: 0 }} />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: '0.3rem' }}>Scopes</div>
            <ScopePicker value={mintScopes} onChange={setMintScopes} bound={callerScopes} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={minting || mintScopes.length === 0}>
              {minting ? 'Minting…' : 'Mint key'}
            </button>
            <button type="button" className="btn-small" onClick={() => setShowMint(false)} disabled={minting}>Cancel</button>
          </div>
        </form>
      )}

      {minted && <NewKeyDisclosure minted={minted} onClose={() => setMinted(null)} />}
    </div>
  );
}

function RegisterAgentForm({
  workspaces,
  callerScopes,
  groupsByWorkspace,
  onCreated,
}: {
  workspaces: WorkspaceListing[];
  callerScopes: string[] | undefined;
  groupsByWorkspace: Record<string, PermissionGroup[]>;
  onCreated: (agent: CreatedAgent) => void;
}) {
  type MembershipDraft = { workspaceId: string; groupIds: string[] };

  const [agentId, setAgentId] = useState('');
  const [nickname, setNickname] = useState('');
  const [keyLabel, setKeyLabel] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(SCOPE_PRESETS[0].scopes.slice());
  const [memberships, setMemberships] = useState<MembershipDraft[]>(() =>
    workspaces.length > 0 ? [{ workspaceId: workspaces[0].id, groupIds: [] }] : [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // When workspaces load asynchronously, pre-fill the first membership row.
  useEffect(() => {
    setMemberships(prev => prev.length > 0 || workspaces.length === 0
      ? prev
      : [{ workspaceId: workspaces[0].id, groupIds: [] }]);
  }, [workspaces]);

  // For each row's workspace, default to the Trader group when its groups load.
  useEffect(() => {
    setMemberships(prev => prev.map(row => {
      if (row.groupIds.length > 0) return row;
      const groups = groupsByWorkspace[row.workspaceId] ?? [];
      const trader = groups.find(g => g.type === 'trader');
      if (!trader) return row;
      return { ...row, groupIds: [trader.id] };
    }));
  }, [groupsByWorkspace]);

  const updateMembership = (idx: number, patch: Partial<MembershipDraft>) => {
    setMemberships(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  };
  const addMembership = () => {
    const used = new Set(memberships.map(m => m.workspaceId));
    const next = workspaces.find(w => !used.has(w.id));
    if (!next) return;
    setMemberships(prev => [...prev, { workspaceId: next.id, groupIds: [] }]);
  };
  const removeMembership = (idx: number) => {
    setMemberships(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const created = await api.createAgent({
        agentId: agentId.trim(),
        nickname: nickname.trim() || undefined,
        keyLabel: keyLabel.trim() || undefined,
        keyScopes,
        memberships: memberships.filter(m => m.groupIds.length > 0),
      }) as CreatedAgent;
      onCreated(created);
      setAgentId('');
      setNickname('');
      setKeyLabel('');
      setKeyScopes(SCOPE_PRESETS[0].scopes.slice());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (workspaces.length === 0) {
    return (
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        You need a workspace before you can register a bot. Create one from the sidebar first.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="reg-agent-id" className="section-label" style={{ display: 'block', marginBottom: '0.3rem' }}>Agent ID</label>
          <input id="reg-agent-id" type="text" value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="my-trading-bot" required style={{ marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="reg-nickname" className="section-label" style={{ display: 'block', marginBottom: '0.3rem' }}>Nickname (optional)</label>
          <input id="reg-nickname" type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Anchor bot" style={{ marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="reg-key-label" className="section-label" style={{ display: 'block', marginBottom: '0.3rem' }}>Key label (optional)</label>
          <input id="reg-key-label" type="text" value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="prod" style={{ marginBottom: 0 }} />
        </div>
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: '0.3rem' }}>Key scopes</div>
        <ScopePicker value={keyScopes} onChange={setKeyScopes} bound={callerScopes} />
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: '0.3rem' }}>Workspace memberships</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '0 0 0.5rem' }}>
          Add the new agent to one or more workspaces and pick the groups it joins. Only workspaces where you have <code>manage</code> capability are listed.
          For per-metric or per-source rules, create a custom group on the <Link to="/participants">Participants</Link> page first, then pick it here.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {memberships.map((m, idx) => {
            const groups = groupsByWorkspace[m.workspaceId] ?? [];
            return (
              <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={m.workspaceId}
                  onChange={e => updateMembership(idx, { workspaceId: e.target.value, groupIds: [] })}
                  style={{ minWidth: 180 }}
                >
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select
                  multiple
                  value={m.groupIds}
                  onChange={e => updateMembership(idx, { groupIds: Array.from(e.target.selectedOptions, o => o.value) })}
                  style={{ minWidth: 220, height: '4.5rem' }}
                >
                  {groups.length === 0 && <option disabled>(loading groups…)</option>}
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {memberships.length > 1 && (
                  <button type="button" className="btn-small btn-delete" onClick={() => removeMembership(idx)}>Remove</button>
                )}
              </div>
            );
          })}
          {memberships.length < workspaces.length && (
            <button type="button" className="btn-small" style={{ alignSelf: 'flex-start' }} onClick={addMembership}>+ another workspace</button>
          )}
        </div>
      </div>

      {error && <div className="message error show">{error}</div>}

      <div>
        <button type="submit" disabled={submitting || !agentId.trim() || keyScopes.length === 0}>
          {submitting ? 'Registering…' : 'Register agent'}
        </button>
      </div>
    </form>
  );
}

function CreatedAgentDisclosure({ agent, onClose }: { agent: CreatedAgent; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="section" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--focus-border)' }}>
      <div className="section-label">Agent registered (key shown once)</div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
        Save this API key now. It won’t be shown again.
      </p>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Agent ID:</span>
        <code style={{ fontFamily: 'monospace' }}>{agent.agentId}</code>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
        <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.5rem 0.6rem', background: 'var(--bg-tertiary)', borderRadius: 4, overflowX: 'auto' }}>
          {agent.apiKey}
        </code>
        <button type="button" className="btn-small" onClick={() => { navigator.clipboard.writeText(agent.apiKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
        {agent.scopes.map(s => <ScopeChip key={s} scope={s} />)}
      </div>
      <div style={{ marginTop: '0.6rem' }}>
        <button type="button" className="btn-small" onClick={onClose}>I’ve saved it</button>
      </div>
    </div>
  );
}

export function ApiPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);
  const { workspaces } = useManageableWorkspaces();
  const [me, setMe] = useState<{ keyId: string | null; scopes: string[] | null; participantId: string | null }>({ keyId: null, scopes: null, participantId: null });
  const [myAgents, setMyAgents] = useState<MyAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createdAgent, setCreatedAgent] = useState<CreatedAgent | null>(null);
  const [groupsByWorkspace, setGroupsByWorkspace] = useState<Record<string, PermissionGroup[]>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await api.getProfile() as { participantId?: string | null; uid?: string | null };
      const mine = await api.getMyAgents() as MyAgentRow[];
      setMe(prev => ({ ...prev, participantId: profile.participantId ?? null }));
      setMyAgents(mine ?? []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload, refreshTick]);

  // Browser sessions never have key scopes. We keep callerScopes undefined,
  // which the ScopePicker treats as "no upper bound" (full access).
  const callerScopes: string[] | undefined = undefined;

  // Load groups per workspace lazily as workspaces become known. We use the
  // active X-Workspace-Id header, so we issue one call per workspace.
  useEffect(() => {
    let cancel = false;
    workspaces.forEach(async ws => {
      if (groupsByWorkspace[ws.id]) return;
      try {
        const groups = await fetch(`${API_BASE}/api/groups`, { credentials: 'include', headers: { 'X-Workspace-Id': ws.id } })
          .then(r => r.ok ? r.json() : []);
        if (cancel) return;
        setGroupsByWorkspace(prev => ({ ...prev, [ws.id]: groups as PermissionGroup[] }));
      } catch (err) {
        console.error(`Failed to load groups for workspace ${ws.id}`, err);
      }
    });
    return () => { cancel = true; };
  }, [workspaces, groupsByWorkspace]);

  // The user's "primary" agent IS them (authUserId === uid; unique by index).
  // Owned bots are agents they registered (ownerUserId === uid). Both come
  // back from /api/agents/mine after migration 0023.
  const primaryAgent = useMemo(() => {
    if (!user) return null;
    return myAgents.find(a => a.authUserId === user.id) ?? null;
  }, [myAgents, user]);
  const botAgents = useMemo(() => {
    return myAgents.filter(a => a !== primaryAgent);
  }, [myAgents, primaryAgent]);

  if (!user) return null;
  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="page-content">
      <div className="container" style={{ maxWidth: 1080, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>API</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Mint API keys for your account, register bot participants, and manage their permissions. Every operation here goes through the same <code>/api/*</code> endpoints external integrations use; see the <Link to="/guides/auth-and-keys">Authentication &amp; keys</Link> guide for the full reference.
        </p>

        {error && <div className="message error show" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* 1. Your own keys */}
        <div className="section" style={{ marginBottom: '1.5rem' }}>
          <h2 className="section-label">Your API access</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Mint a key here to call the API as yourself instead of from a browser session. These keys identify as your participant ({primaryAgent?.id ?? 'pending'}); their scopes filter what they can do.
          </p>
          {primaryAgent ? (
            <KeysList
              agentId={primaryAgent.id}
              currentKeyId={me.keyId}
              callerScopes={callerScopes}
              onMintedSomething={() => setRefreshTick(t => t + 1)}
            />
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Your participant identity is being provisioned. Refresh the page in a moment, or visit <Link to="/account">Account</Link> to bootstrap one.
            </p>
          )}
        </div>

        {/* 2. Bot agents you own */}
        <div className="section" style={{ marginBottom: '1.5rem' }}>
          <h2 className="section-label">Bot participants you own</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            These are participants you registered via the form below. Each is an independent identity with its own keys; you can manage their scopes here without touching the original key.
          </p>
          {botAgents.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>None yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {botAgents.map(a => (
                <details key={a.id} style={{ borderTop: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
                  <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <code style={{ fontFamily: 'monospace', fontWeight: 600 }}>{a.id}</code>
                    {a.nickname && <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{a.nickname}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{a.balance.toFixed(2)} cr</span>
                  </summary>
                  <div style={{ paddingTop: '0.6rem' }}>
                    <KeysList
                      agentId={a.id}
                      currentKeyId={null}
                      callerScopes={callerScopes}
                      onMintedSomething={() => setRefreshTick(t => t + 1)}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        {/* 3. Register a new bot */}
        <div className="section" style={{ marginBottom: '1.5rem' }}>
          <h2 className="section-label">Register a new bot</h2>
          <RegisterAgentForm
            workspaces={workspaces}
            callerScopes={callerScopes}
            groupsByWorkspace={groupsByWorkspace}
            onCreated={setCreatedAgent}
          />
          {createdAgent && (
            <div style={{ marginTop: '1rem' }}>
              <CreatedAgentDisclosure agent={createdAgent} onClose={() => { setCreatedAgent(null); setRefreshTick(t => t + 1); }} />
            </div>
          )}
        </div>

        {/* 4. Quick reference */}
        <div className="section">
          <h2 className="section-label">Quick reference</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Send your key as <code>X-Agent-Key</code> and the workspace as <code>X-Workspace-Id</code>. Three example requests:
          </p>
          <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 4, fontSize: '0.78rem', overflowX: 'auto' }}>{`# 1. Read workspace status (compact metrics + markets)
curl -H "X-Agent-Key: <your-key>" \\
     -H "X-Workspace-Id: ${workspace?.workspaceId ?? '<workspace-id>'}" \\
     ${API_BASE || 'https://telarchy.com'}/api/status?markets=1

# 2. Place a trade
curl -X POST -H "X-Agent-Key: <your-key>" \\
     -H "X-Workspace-Id: ${workspace?.workspaceId ?? '<workspace-id>'}" \\
     -H "Content-Type: application/json" \\
     -d '{"metricName":"Throughput","targetDate":"2026-Q4","direction":"higher","amount":10}' \\
     ${API_BASE || 'https://telarchy.com'}/api/predictions/trade

# 3. List your own keys (requires account:keys scope on the calling key)
curl -H "X-Agent-Key: <your-key>" \\
     ${API_BASE || 'https://telarchy.com'}/api/agents/me/keys`}</pre>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
            Full endpoint list: <Link to="/guides/api-reference">API reference</Link> · Recipes: <Link to="/guides/recipes">Recipes</Link> · Auth: <Link to="/guides/auth-and-keys">Authentication &amp; keys</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// Note: ScopeValue import is kept type-only for downstream consumers (vitest tests).
export type { ScopeValue };
