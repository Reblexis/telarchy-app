import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceDetail {
  id: string;
  name: string;
  autoFundNewMarkets?: boolean;
  newMarketLiquidityCredits?: number;
}

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [autoFund, setAutoFund] = useState(false);
  const [liquidityCredits, setLiquidityCredits] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const [wsLoading, setWsLoading] = useState(true);

  const wsId = workspace?.workspaceId;
  const isOwner = workspace?.memberRole === 'owner';

  useEffect(() => {
    if (!user || !wsId) { setWsLoading(false); return; }
    setWsLoading(true);
    api.getWorkspace(wsId)
      .then(detail => {
        const d = detail as WorkspaceDetail;
        setWs(d);
        setName(d.name);
        setAutoFund(Boolean(d.autoFundNewMarkets));
        const c = d.newMarketLiquidityCredits;
        setLiquidityCredits(typeof c === 'number' && c > 0 ? String(c) : '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setWsLoading(false));
  }, [user, wsId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId) return;
    setError(''); setSaveMsg(''); setSaving(true);
    try {
      await api.updateWorkspaceSettings(wsId, { name: name.trim() });
      setSaveMsg('Saved.');
      setWs(prev => prev ? { ...prev, name: name.trim() } : prev);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMarkets = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId || !isOwner) return;
    const credits = parseFloat(liquidityCredits);
    if (autoFund && (!Number.isFinite(credits) || credits <= 0)) {
      setError('Enter a positive credit amount per new market when auto-fund is on.');
      return;
    }
    setError(''); setSaveMsg(''); setSaving(true);
    try {
      const body: { autoFundNewMarkets?: boolean; newMarketLiquidityCredits?: number } = {};
      if (!autoFund) {
        body.autoFundNewMarkets = false;
      } else {
        body.autoFundNewMarkets = true;
        body.newMarketLiquidityCredits = credits;
      }
      await api.updateWorkspaceSettings(wsId, body);
      setSaveMsg('Saved.');
      setWs(prev => prev ? {
        ...prev,
        autoFundNewMarkets: autoFund,
        newMarketLiquidityCredits: autoFund ? credits : (prev.newMarketLiquidityCredits ?? 0),
      } : prev);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (wsLoading) return <div className="loading">Loading…</div>;

  if (!workspace) {
    return (
      <div className="container" style={{ maxWidth: 600 }}>
        <h1>Workspace Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>No workspace found.</p>
      </div>
    );
  }

  if (workspace.tier !== 'admin') {
    return (
      <div className="container" style={{ maxWidth: 600 }}>
        <h1>Workspace Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Only workspace admins can manage settings.</p>
        <button type="button" onClick={() => navigate('/metrics')}>Back to metrics</button>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Workspace Settings</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        ID: <code style={{ fontSize: '0.8rem' }}>{wsId}</code>
      </p>

      {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="section">
        <h3 style={{ marginBottom: '1rem' }}>General</h3>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="ws-name">Workspace name</label>
            <input
              id="ws-name"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saveMsg && <span style={{ marginLeft: '1rem', fontSize: '0.875rem', color: 'var(--success-text)' }}>{saveMsg}</span>}
        </form>
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Markets</h3>
        {isOwner ? (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Automatically fund new markets from your agent balance. Each new non-task market will debit the amount below.
            </p>
            <form onSubmit={handleSaveMarkets}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  id="auto-fund"
                  type="checkbox"
                  checked={autoFund}
                  onChange={e => setAutoFund(e.target.checked)}
                />
                <label htmlFor="auto-fund" style={{ margin: 0 }}>Auto-fund new markets</label>
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
                  />
                </div>
              )}
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </form>
          </>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Only the workspace owner can configure market funding.
          </p>
        )}
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Manage access by adding participants to permission groups in the{' '}
          <button
            type="button"
            onClick={() => navigate('/agents')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--focus-border)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}
          >
            Agents
          </button>{' '}
          page. The Admin group grants full workspace access.
        </p>
      </div>

      {isOwner && (
        <div className="section" style={{ marginTop: '3rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', color: 'var(--error-text)' }}>Danger zone</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Permanently delete this workspace and all its data. All open markets will be voided and stakes refunded.
          </p>
          <button
            type="button"
            className="btn-delete"
            disabled={saving}
            onClick={async () => {
              if (!wsId) return;
              const confirmed = window.confirm(
                `Delete workspace "${ws?.name ?? wsId}"?\n\nAll markets will be voided (stakes refunded), and all metrics, trades, and history will be permanently deleted. This cannot be undone.`
              );
              if (!confirmed) return;
              setSaving(true); setError('');
              try {
                await api.deleteWorkspace(wsId);
                navigate('/');
              } catch (e: unknown) {
                setError((e as Error).message);
                setSaving(false);
              }
            }}
          >
            {saving ? 'Deleting...' : 'Delete workspace'}
          </button>
        </div>
      )}
    </div>
  );
}
