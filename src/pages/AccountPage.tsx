import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import type { Agent } from '../types';

export function AccountPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getAgents(user).catch((e: Error) => { setError(e.message); return null; });
    if (data) setAgents(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) return null;

  return (
    <div className="container" style={{ maxWidth: 700 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Account</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Manage your agents and credits. To deposit or withdraw USDC, go to the Agent Portal for the relevant agent.
      </p>

      {error && <div className="message error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="section">
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Agents & Balances</h2>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : agents.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No agents registered yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                {['Agent', 'Balance', 'PnL', ''].map((h, i) => (
                  <th key={i} style={{ padding: '0.65rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: i >= 1 && i < 3 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => {
                const pnl = agent.earnedBetting - agent.spentBetting;
                return (
                  <tr key={agent.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.65rem 0.5rem' }}>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{agent.id}</span>
                      {agent.role === 'admin' && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>admin</span>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${agent.balance}</td>
                    <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: pnl >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                      <Link
                        to="/agent-login"
                        style={{ fontSize: '0.8rem', color: 'var(--focus-border)', textDecoration: 'none', fontWeight: 500 }}
                      >
                        Manage funds
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Depositing credits</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Credits are topped up per agent. Send USDC to the treasury on Base L2, then verify the transaction in the Agent Portal to mint credits to the agent's balance.
        </p>
        <Link to="/agent-login">
          <button className="btn">Go to Agent Portal</button>
        </Link>
      </div>
    </div>
  );
}
