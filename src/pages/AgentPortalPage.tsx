import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentApi } from '../lib/api';
import { useAgentSession } from '../hooks/useAgentSession';
import { Header } from '../components/Header';

import type { Market, Position } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentProfile {
  id: string;
  role: string;
  balance: number;
  earnedBetting: number;
  spentBetting: number;
  spentTokens: number;
  walletAddress?: string;
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function OverviewSection({ profile }: { profile: AgentProfile }) {
  const pnl = profile.earnedBetting - profile.spentBetting;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <StatCard label="Balance" value={`$${profile.balance.toFixed(2)}`} />
        <StatCard
          label="Betting PnL"
          value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
          valueColor={pnl >= 0 ? 'var(--success-text)' : 'var(--error-text)'}
        />
        <StatCard label="Won" value={`$${profile.earnedBetting.toFixed(2)}`} valueColor="var(--success-text)" />
        <StatCard label="Spent on bets" value={`$${profile.spentBetting.toFixed(2)}`} valueColor="var(--error-text)" />
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Role: <strong style={{ color: 'var(--text-primary)' }}>{profile.role}</strong>
        {profile.walletAddress && (
          <span style={{ marginLeft: '1rem' }}>
            Wallet: <code style={{ fontSize: '0.78rem' }}>{profile.walletAddress}</code>
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem', color: valueColor ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function MarketsSection({ agentId, apiKey }: { agentId: string; apiKey: string }) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tradeAmount, setTradeAmount] = useState<Record<string, string>>({});
  const [tradeStatus, setTradeStatus] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [trading, setTrading] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const data = await agentApi.getMarkets(agentId, apiKey).catch((e: Error) => { console.error('getMarkets:', e); return []; });
    setMarkets((data as Market[]).filter((m: Market) => m.active));
    setLoading(false);
  }, [agentId, apiKey]);

  useEffect(() => { load(); }, [load]);

  const handleTrade = async (market: Market, direction: 'higher' | 'lower') => {
    const amount = parseFloat(tradeAmount[market.id] ?? '');
    if (!amount || amount <= 0) return;
    setTrading(prev => ({ ...prev, [market.id]: true }));
    setTradeStatus(prev => ({ ...prev, [market.id]: { ok: false, msg: '' } }));
    try {
      await agentApi.trade(agentId, apiKey, { marketId: market.id, direction, amount });
      setTradeStatus(prev => ({ ...prev, [market.id]: { ok: true, msg: `${direction === 'higher' ? 'Higher' : 'Lower'} bet placed for $${amount}` } }));
      setTradeAmount(prev => ({ ...prev, [market.id]: '' }));
      load();
    } catch (err: unknown) {
      setTradeStatus(prev => ({ ...prev, [market.id]: { ok: false, msg: (err as Error).message } }));
    } finally {
      setTrading(prev => ({ ...prev, [market.id]: false }));
    }
  };

  if (loading) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading markets…</p>;
  if (markets.length === 0) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No active markets available.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {markets.map(m => {
        const isExpanded = expandedId === m.id;
        const prob = m.probability ?? 0.5;
        const status = tradeStatus[m.id];
        const isTrading = trading[m.id] ?? false;

        return (
          <div key={m.id} style={{ border: '1px solid var(--border-color)', borderRadius: '0.375rem', overflow: 'hidden' }}>
            <div
              onClick={() => setExpandedId(isExpanded ? null : m.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : undefined }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{m.metricName}</span>
                <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{m.targetDate}</span>
              </div>
              <ProbabilityBar prob={prob} />
              <div style={{ textAlign: 'right', minWidth: 80 }}>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
                  {m.consensus !== null && m.consensus !== undefined ? m.consensus.toFixed(2) : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>consensus</div>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Range: {m.rangeMin} – {m.rangeMax} · Liquidity: ${m.liquidity.toFixed(2)} · P(higher): {(prob * 100).toFixed(1)}%
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    placeholder="Amount ($)"
                    min="0.01"
                    step="0.01"
                    value={tradeAmount[m.id] ?? ''}
                    onChange={e => setTradeAmount(prev => ({ ...prev, [m.id]: e.target.value }))}
                    style={{ width: 130, marginBottom: 0 }}
                  />
                  <button
                    onClick={() => handleTrade(m, 'higher')}
                    disabled={isTrading || !tradeAmount[m.id]}
                    style={{ background: 'var(--success-bg)', color: 'var(--success-text)', border: '1px solid var(--success-text)', borderRadius: '0.375rem', padding: '0.4rem 0.8rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                  >
                    Higher ↑
                  </button>
                  <button
                    onClick={() => handleTrade(m, 'lower')}
                    disabled={isTrading || !tradeAmount[m.id]}
                    style={{ background: 'var(--error-bg, var(--bg-tertiary))', color: 'var(--error-text)', border: '1px solid var(--error-text)', borderRadius: '0.375rem', padding: '0.4rem 0.8rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                  >
                    Lower ↓
                  </button>
                </div>
                {status?.msg && (
                  <div className={`message ${status.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>
                    {status.msg}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProbabilityBar({ prob }: { prob: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${prob * 100}%`, height: '100%', background: 'var(--focus-border)', borderRadius: 3, transition: 'width 0.2s' }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: 34, textAlign: 'right' }}>
        {(prob * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function PositionsSection({ agentId, apiKey }: { agentId: string; apiKey: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentApi.getPositions(agentId, apiKey)
      .then(data => setPositions(data as Position[]))
      .catch((e: Error) => console.error('getPositions:', e))
      .finally(() => setLoading(false));
  }, [agentId, apiKey]);

  if (loading) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading positions…</p>;
  if (positions.length === 0) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No open positions.</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
          {['Market', 'Direction', 'Shares'].map((h, i) => (
            <th key={h} style={{ padding: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: i === 0 ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{p.marketId}</span>
            </td>
            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
              <span style={{
                fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '999px', fontWeight: 600,
                background: p.direction === 'higher' ? 'var(--success-bg)' : 'var(--error-bg, var(--bg-tertiary))',
                color: p.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)',
              }}>
                {p.direction}
              </span>
            </td>
            <td style={{ padding: '0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.875rem' }}>
              {p.shares.toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsSection({ agentId, apiKey, profile, onProfileRefresh }: {
  agentId: string;
  apiKey: string;
  profile: AgentProfile;
  onProfileRefresh: () => void;
}) {
  const [walletAddr, setWalletAddr] = useState(profile.walletAddress ?? '');
  const [savingWallet, setSavingWallet] = useState(false);

  // Keep local input in sync when profile is refreshed after a successful save
  useEffect(() => { setWalletAddr(profile.walletAddress ?? ''); }, [profile.walletAddress]);
  const [walletMsg, setWalletMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [txHash, setTxHash] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositMsg, setDepositMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSaveWallet = async (e: FormEvent) => {
    e.preventDefault();
    setSavingWallet(true);
    setWalletMsg(null);
    try {
      await agentApi.setWallet(agentId, apiKey, walletAddr.trim());
      setWalletMsg({ ok: true, text: 'Wallet address saved.' });
      onProfileRefresh();
    } catch (err: unknown) {
      setWalletMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSavingWallet(false);
    }
  };

  const handleDeposit = async (e: FormEvent) => {
    e.preventDefault();
    setDepositing(true);
    setDepositMsg(null);
    try {
      const result = await agentApi.deposit(agentId, apiKey, txHash.trim()) as { credits: number };
      setDepositMsg({ ok: true, text: `Deposit verified — ${result.credits} credits added.` });
      setTxHash('');
      onProfileRefresh();
    } catch (err: unknown) {
      setDepositMsg({ ok: false, text: (err as Error).message });
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) return;
    setWithdrawing(true);
    setWithdrawMsg(null);
    try {
      const result = await agentApi.withdraw(agentId, apiKey, amount) as { usdcAmount: number; txHash: string };
      setWithdrawMsg({ ok: true, text: `Withdrew ${result.usdcAmount} USDC. Tx: ${result.txHash}` });
      setWithdrawAmount('');
      onProfileRefresh();
    } catch (err: unknown) {
      setWithdrawMsg({ ok: false, text: (err as Error).message });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Wallet */}
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Base wallet address</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          Register your Base L2 wallet to enable USDC withdrawals.
        </p>
        <form onSubmit={handleSaveWallet} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="0x…"
            value={walletAddr}
            onChange={e => setWalletAddr(e.target.value)}
            style={{ flex: 1, minWidth: 260, marginBottom: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}
            required
          />
          <button type="submit" disabled={savingWallet || !walletAddr.trim()} style={{ whiteSpace: 'nowrap' }}>
            {savingWallet ? 'Saving…' : 'Save wallet'}
          </button>
        </form>
        {walletMsg && <div className={`message ${walletMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>{walletMsg.text}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)' }} />

      {/* Deposit */}
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Deposit credits</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          Send USDC to the treasury on Base, then paste the transaction hash here to mint credits.
        </p>
        <form onSubmit={handleDeposit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="0x transaction hash"
            value={txHash}
            onChange={e => setTxHash(e.target.value)}
            style={{ flex: 1, minWidth: 260, marginBottom: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}
            required
          />
          <button type="submit" disabled={depositing || !txHash.trim()} style={{ whiteSpace: 'nowrap' }}>
            {depositing ? 'Verifying…' : 'Verify & deposit'}
          </button>
        </form>
        {depositMsg && <div className={`message ${depositMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem' }}>{depositMsg.text}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)' }} />

      {/* Withdraw */}
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Withdraw credits</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          Convert credits to USDC sent to your registered wallet.{' '}
          {!profile.walletAddress && <strong>Register a wallet address first.</strong>}
        </p>
        <form onSubmit={handleWithdraw} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="number"
            placeholder="Amount (credits)"
            min="0.01"
            step="0.01"
            value={withdrawAmount}
            onChange={e => setWithdrawAmount(e.target.value)}
            style={{ width: 200, marginBottom: 0 }}
            required
          />
          <button type="submit" disabled={withdrawing || !withdrawAmount || !profile.walletAddress} style={{ whiteSpace: 'nowrap' }}>
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </form>
        {withdrawMsg && <div className={`message ${withdrawMsg.ok ? 'success' : 'error'} show`} style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>{withdrawMsg.text}</div>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Section = 'overview' | 'markets' | 'positions' | 'settings';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'overview',  label: 'Overview',  icon: '◈' },
  { id: 'markets',   label: 'Markets',   icon: '⇅' },
  { id: 'positions', label: 'Positions', icon: '▤' },
  { id: 'settings',  label: 'Settings',  icon: '⚙' },
];

export function AgentPortalPage() {
  const navigate = useNavigate();
  const { session, logout } = useAgentSession();
  const [section, setSection] = useState<Section>('overview');
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [profileError, setProfileError] = useState('');

  const { agentId, apiKey } = session!;

  const loadProfile = useCallback(async () => {
    setProfileError('');
    try {
      const data = await agentApi.getProfile(agentId, apiKey) as AgentProfile;
      setProfile(data);
    } catch (err: unknown) {
      setProfileError((err as Error).message);
    }
  }, [agentId, apiKey]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleLogout = () => {
    logout();
    navigate('/agent-login');
  };

  return (
    <>
      <Header
        navMode="agent"
        actions={
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        }
      />
      <div className="portal-layout">
        {/* Left sidebar */}
        <aside className="portal-sidebar">
          <div className="portal-sidebar-header">
            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem', fontWeight: 500 }}>
              Participant
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.875rem', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
              {agentId}
            </div>
            {profile && (
              <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem' }}>${profile.balance.toFixed(2)}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>credits</span>
              </div>
            )}
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`portal-nav-item${section === s.id ? ' active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </aside>

        {/* Main content */}
        <main>
          {profileError && <div className="message error show" style={{ marginBottom: '1rem' }}>{profileError}</div>}
          <div className="section">
            {section === 'overview' && (
              profile
                ? <OverviewSection profile={profile} />
                : <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading profile…</p>
            )}
            {section === 'markets' && (
              <MarketsSection agentId={agentId} apiKey={apiKey} />
            )}
            {section === 'positions' && (
              <PositionsSection agentId={agentId} apiKey={apiKey} />
            )}
            {section === 'settings' && profile && (
              <SettingsSection agentId={agentId} apiKey={apiKey} profile={profile} onProfileRefresh={loadProfile} />
            )}
            {section === 'settings' && !profile && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
