import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceDetail {
  id: string;
  name: string;
  visibility?: 'public' | 'unlisted' | 'private';
  autoFundNewMarkets?: boolean;
  newMarketLiquidityCredits?: number;
  defaultProposalLiquidity?: number;
}

type Access = 'private' | 'public' | 'open';

interface PublicGroupState {
  id: string;
  capabilities: string[];
}

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [access, setAccess] = useState<Access>('private');
  const [publicGroup, setPublicGroup] = useState<PublicGroupState | null>(null);
  const [autoFund, setAutoFund] = useState(false);
  const [liquidityCredits, setLiquidityCredits] = useState('');
  const [defaultProposalLiquidity, setDefaultProposalLiquidity] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [wsLoading, setWsLoading] = useState(true);

  const wsId = workspace?.workspaceId;
  // Lifecycle-shaped settings (visibility, auto-fund, liquidity defaults, deletion)
  // are gated by the `manage_workspace` capability. Owners hold it implicitly;
  // the Admin group holds it by default; the Participants tab can revoke it.
  const canManageWorkspace = workspace?.capabilities.includes('manage_workspace') ?? false;

  useEffect(() => {
    if (!user || !wsId) { setWsLoading(false); return; }
    setWsLoading(true);
    Promise.all([
      api.getWorkspace(wsId),
      api.listGroups().catch(() => []),
    ])
      .then(([detail, groups]) => {
        const d = detail as WorkspaceDetail;
        setWs(d);
        setName(d.name);
        const pub = (groups as Array<{ id: string; type: string; capabilities?: string[] }>)
          .find(g => g.type === 'public');
        const pubCaps = pub?.capabilities ?? [];
        setPublicGroup(pub ? { id: pub.id, capabilities: pubCaps } : null);
        const listed = d.visibility === 'public';
        setAccess(!listed ? 'private' : (pubCaps.includes('trade') ? 'open' : 'public'));
        setAutoFund(Boolean(d.autoFundNewMarkets));
        const c = d.newMarketLiquidityCredits;
        setLiquidityCredits(typeof c === 'number' && c > 0 ? String(c) : '');
        const p = d.defaultProposalLiquidity;
        setDefaultProposalLiquidity(typeof p === 'number' && p > 0 ? String(p) : '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setWsLoading(false));
  }, [user, wsId]);

  useEffect(() => {
    if (savedAt == null) return;
    const id = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(id);
  }, [savedAt]);

  const markSaved = () => { setError(''); setSavedAt(Date.now()); };
  const markError = (e: unknown) => setError((e as Error).message);

  const commitName = async () => {
    if (!user || !wsId) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === ws?.name) return;
    try {
      await api.updateWorkspaceSettings(wsId, { name: trimmed });
      setWs(prev => prev ? { ...prev, name: trimmed } : prev);
      markSaved();
    } catch (e) { markError(e); }
  };

  const commitAccess = async (nextAccess: Access) => {
    if (!user || !wsId || !canManageWorkspace) return;
    const prevAccess = access;
    setAccess(nextAccess);
    try {
      const nextVisibility: 'public' | 'private' = nextAccess === 'private' ? 'private' : 'public';
      await api.updateWorkspaceSettings(wsId, { visibility: nextVisibility });
      if (publicGroup) {
        const current = publicGroup.capabilities;
        const hasTrade = current.includes('trade');
        const shouldTrade = nextAccess === 'open';
        if (hasTrade !== shouldTrade) {
          const nextCaps = shouldTrade
            ? Array.from(new Set([...current, 'read', 'trade']))
            : current.filter(c => c !== 'trade');
          await api.updateGroup(publicGroup.id, { capabilities: nextCaps });
          setPublicGroup({ ...publicGroup, capabilities: nextCaps });
        }
      }
      setWs(prev => prev ? { ...prev, visibility: nextVisibility } : prev);
      markSaved();
    } catch (e) {
      setAccess(prevAccess);
      markError(e);
    }
  };

  const commitMarkets = async (nextAutoFund: boolean, nextCredits: string) => {
    if (!user || !wsId || !canManageWorkspace) return;
    const credits = parseFloat(nextCredits);
    if (nextAutoFund && (!Number.isFinite(credits) || credits <= 0)) {
      setError('Enter a positive credit amount per new market when auto-fund is on.');
      return;
    }
    const sameAutoFund = Boolean(ws?.autoFundNewMarkets) === nextAutoFund;
    const sameCredits = nextAutoFund
      ? ws?.newMarketLiquidityCredits === credits
      : true;
    if (sameAutoFund && sameCredits) return;
    try {
      const body: { autoFundNewMarkets?: boolean; newMarketLiquidityCredits?: number } = {};
      if (!nextAutoFund) {
        body.autoFundNewMarkets = false;
      } else {
        body.autoFundNewMarkets = true;
        body.newMarketLiquidityCredits = credits;
      }
      await api.updateWorkspaceSettings(wsId, body);
      setWs(prev => prev ? {
        ...prev,
        autoFundNewMarkets: nextAutoFund,
        newMarketLiquidityCredits: nextAutoFund ? credits : (prev.newMarketLiquidityCredits ?? 0),
      } : prev);
      markSaved();
    } catch (e) { markError(e); }
  };

  const handleAutoFundToggle = (checked: boolean) => {
    setAutoFund(checked);
    if (!checked) {
      void commitMarkets(false, liquidityCredits);
    } else if (parseFloat(liquidityCredits) > 0) {
      // If a valid amount is already set, save immediately.
      void commitMarkets(true, liquidityCredits);
    }
    // Otherwise wait for the user to enter a valid number and blur.
  };

  const commitDefaultProposalLiquidity = async (raw: string) => {
    if (!user || !wsId || !canManageWorkspace) return;
    const trimmed = raw.trim();
    const value = trimmed === '' ? 0 : parseFloat(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      setError('Default proposal liquidity must be a non-negative number');
      return;
    }
    if (value > 0 && value < 0.1) {
      setError('Default proposal liquidity must be at least 0.1 credits per market when set');
      return;
    }
    if ((ws?.defaultProposalLiquidity ?? 0) === value) return;
    try {
      await api.updateWorkspaceSettings(wsId, { defaultProposalLiquidity: value });
      setWs(prev => prev ? { ...prev, defaultProposalLiquidity: value } : prev);
      markSaved();
    } catch (e) { markError(e); }
  };

  if (wsLoading) return <div className="loading">Loading…</div>;

  if (!workspace) {
    return (
      <div className="container">
        <div className="section-header">
          <h2>Workspace Settings</h2>
          <p className="section-subtitle">No workspace found.</p>
        </div>
      </div>
    );
  }

  if (workspace.tier !== 'admin') {
    return (
      <div className="container">
        <div className="section-header">
          <h2>Workspace Settings</h2>
          <p className="section-subtitle">Only workspace admins can manage settings.</p>
        </div>
        <button type="button" onClick={() => navigate('/metrics')}>Back to metrics</button>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="section-header section-header--with-status">
        <div>
          <h2>Workspace Settings</h2>
          <p className="section-subtitle">
            ID: <code style={{ fontSize: '0.8rem' }}>{wsId}</code>
          </p>
        </div>
        <span className={`settings-saved-pip${savedAt != null ? ' settings-saved-pip--visible' : ''}`} aria-live="polite">
          Saved
        </span>
      </div>

      <div style={{ maxWidth: 640 }}>
      {error && <div className="message error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="section">
        <h3 style={{ marginBottom: '1rem' }}>General</h3>
        <div className="form-group">
          <label htmlFor="ws-name">Workspace name</label>
          <input
            id="ws-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
          />
        </div>
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Access</h3>
        {canManageWorkspace ? (
          <div className="form-group">
            <div className="radio-card-group">
              {([
                { id: 'private' as const, label: 'Private', help: 'Invite-only. Not listed anywhere.' },
                { id: 'public'  as const, label: 'Public',  help: 'Listed publicly. Anyone can join and view.' },
                { id: 'open'    as const, label: 'Open',    help: 'Listed publicly. Anyone can join and trade.' },
              ]).map(opt => (
                <label key={opt.id} className={`radio-card${access === opt.id ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="ws-access"
                    value={opt.id}
                    checked={access === opt.id}
                    onChange={() => commitAccess(opt.id)}
                  />
                  <span className="radio-card-body">
                    <span className="radio-card-title">{opt.label}</span>
                    <span className="radio-card-help">{opt.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Requires the manage_workspace permission. An owner can grant it on the Participants tab.
          </p>
        )}
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Markets</h3>
        {canManageWorkspace ? (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Automatically fund new markets from your agent balance. Each new non-proposal market will debit the amount below.
            </p>
            <div className="form-group">
              <label htmlFor="auto-fund" className="checkbox-label">
                <input
                  id="auto-fund"
                  type="checkbox"
                  checked={autoFund}
                  onChange={e => handleAutoFundToggle(e.target.checked)}
                />
                Auto-fund new markets
              </label>
            </div>
            {autoFund && (
              <div className="form-group">
                <label htmlFor="liq-credits">Credits per market</label>
                <input
                  id="liq-credits"
                  type="number"
                  step="any"
                  value={liquidityCredits}
                  onChange={e => setLiquidityCredits(e.target.value)}
                  onBlur={() => commitMarkets(autoFund, liquidityCredits)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
                />
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Requires the manage_workspace permission. An owner can grant it on the Participants tab.
          </p>
        )}
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Proposals</h3>
        {canManageWorkspace ? (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Default subsidy per conditional market when a participant proposes a new proposal. The proposer is debited (refunded if declined).
              Set to 0 to ask each time. Min 0.1 credits per market when set.
            </p>
            <div className="form-group">
              <label htmlFor="proposal-liq">Default proposal liquidity (credits per market)</label>
              <input
                id="proposal-liq"
                type="number"
                step="any"
                min="0"
                placeholder="0 (ask each time)"
                value={defaultProposalLiquidity}
                onChange={e => setDefaultProposalLiquidity(e.target.value)}
                onBlur={() => commitDefaultProposalLiquidity(defaultProposalLiquidity)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
              />
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Requires the manage_workspace permission. An owner can grant it on the Participants tab.
          </p>
        )}
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Manage access by adding participants to permission groups in the{' '}
          <button
            type="button"
            onClick={() => navigate('/participants')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--focus-border)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}
          >
            Participants
          </button>{' '}
          page. The Admin group grants full workspace access.
        </p>
      </div>

      {canManageWorkspace && (
        <div className="section" style={{ marginTop: '3rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', color: 'var(--error-text)' }}>Danger zone</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Permanently delete this workspace and all its data. All open markets will be voided and stakes refunded.
          </p>
          <button
            type="button"
            className="btn-delete"
            disabled={deleting}
            onClick={async () => {
              if (!wsId) return;
              const confirmed = window.confirm(
                `Delete workspace "${ws?.name ?? wsId}"?\n\nAll markets will be voided (stakes refunded), and all metrics, trades, and history will be permanently deleted. This cannot be undone.`
              );
              if (!confirmed) return;
              setDeleting(true); setError('');
              try {
                await api.deleteWorkspace(wsId);
                navigate('/');
              } catch (e: unknown) {
                setError((e as Error).message);
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Deleting...' : 'Delete workspace'}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
