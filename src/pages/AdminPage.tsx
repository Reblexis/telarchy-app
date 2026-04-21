import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { Header } from '../components/Header';

export function AdminPage() {
  const { user } = useAuth();
  const [usdcEnabled, setUsdcEnabled] = useState<boolean | null>(null);
  const [treasury, setTreasury] = useState<{ address: string; usdcBalance: number; ethBalance: number } | null>(null);
  const [treasuryError, setTreasuryError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getStatus()
      .then(s => {
        const enabled = Boolean((s as { usdcSettlementEnabled?: boolean }).usdcSettlementEnabled);
        setUsdcEnabled(enabled);
        if (enabled) {
          api.getTreasury()
            .then(data => setTreasury(data as { address: string; usdcBalance: number; ethBalance: number }))
            .catch((e: Error) => setTreasuryError(e.message));
        }
      })
      .catch(() => setUsdcEnabled(false));
  }, [user]);

  if (!user || usdcEnabled === null) return <div className="loading">Loading…</div>;

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <h1 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>Platform Admin</h1>

        {!usdcEnabled && (
          <div
            className="section"
            style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            USDC settlement is disabled on this instance. Credits are play-money only; no on-chain
            treasury is configured. Set <code>USDC_SETTLEMENT_ENABLED=true</code> and restart the
            server to enable the treasury view.
          </div>
        )}

        {treasuryError && (
          <div className="error show" style={{ marginBottom: '1rem' }}>{treasuryError}</div>
        )}

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
