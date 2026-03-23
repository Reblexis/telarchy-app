import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import { Header } from '../components/Header';

export function AdminPage() {
  const { user } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace, loading } = useWorkspace(user);
  const [treasury, setTreasury] = useState<{ address: string; usdcBalance: number; ethBalance: number } | null>(null);
  const [treasuryError, setTreasuryError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getTreasury(user)
      .then(data => setTreasury(data as { address: string; usdcBalance: number; ethBalance: number }))
      .catch((e: Error) => setTreasuryError(e.message));
  }, [user]);

  if (!user || loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <Header
        workspaces={allWorkspaces}
        activeWorkspaceId={workspace?.workspaceId}
        onWorkspaceSwitch={switchWorkspace}
      />
      <div className="container">
        <h1 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>Platform Admin</h1>

        {treasuryError && <div className="error show" style={{ marginBottom: '1rem' }}>{treasuryError}</div>}

        {treasury && (
          <div className="section">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Treasury (Base)</h2>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>USDC</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>${treasury.usdcBalance.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>ETH</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>{treasury.ethBalance.toFixed(6)} ETH</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Address</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{treasury.address}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
