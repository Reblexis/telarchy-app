import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useImpersonation } from '../hooks/useImpersonation';
import { api } from '../lib/api';
import type { Agent } from '../types';

export function AgentsPage() {
  const { user, loading: authLoading } = useAuth();
  useDarkMode();
  const { agentId: impersonatedId, setAgentId: setImpersonated } = useImpersonation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAgents = useCallback(async () => {
    if (!user) return;
    setError('');
    const data = await api.getAgents(user).catch((e: Error) => { setError(e.message); return null; });
    if (data) setAgents(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleApprove = async (id: string) => {
    if (!user) return;
    await api.approveAgent(user, id);
    loadAgents();
  };

  const handleDelete = async (id: string) => {
    if (!user || !confirm(`Delete agent "${id}"?`)) return;
    await api.deleteAgent(user, id);
    loadAgents();
  };

  const handleCredit = async (id: string) => {
    if (!user) return;
    const input = prompt('Credits to add:');
    if (!input) return;
    const amount = Number(input);
    if (!amount || amount <= 0) return;
    await api.creditAgent(user, id, amount, 'Manual credit', impersonatedId);
    loadAgents();
  };

  const handleRoleChange = async (id: string, role: string) => {
    if (!user) return;
    await api.setAgentRole(user, id, role);
    loadAgents();
  };

  if (authLoading || !user) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="header">
        <img src="/logo.png" alt="Telarchy" style={{ height: '5.25rem' }} />
        <nav className="header-nav">
          <Link to="/metrics" className="nav-link">Metrics</Link>
          <Link to="/agents" className="nav-link active">Agents</Link>
          <Link to="/markets" className="nav-link">Markets</Link>
        </nav>
        <div className="header-actions">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Acting as: <strong>{impersonatedId}</strong></span>
        </div>
      </div>
      <div className="container">
        {error && <div className="message error show">{error}</div>}
        {loading ? (
          <div className="loading">Loading agents...</div>
        ) : agents.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No agents registered yet.</p></div>
        ) : (
          <div className="section">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Agent</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Role</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>Balance</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>Gifted</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>Bet Won</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>Bet Spent</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>Tokens</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'right' }}>PnL</th>
                  <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id} style={{ borderBottom: '1px solid var(--border-color)', background: agent.id === impersonatedId ? 'var(--bg-secondary, #f0f4ff)' : undefined }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{agent.id}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <select
                        value={agent.role}
                        onChange={(e) => handleRoleChange(agent.id, e.target.value)}
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', borderRadius: '4px' }}
                      >
                        <option value="pending">pending</option>
                        <option value="agent">agent</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>{agent.balance}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{agent.gifted}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>{agent.earnedBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>{agent.spentBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{agent.spentTokens}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: agent.earnedBetting - agent.spentBetting >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                      {agent.earnedBetting - agent.spentBetting >= 0 ? '+' : ''}{agent.earnedBetting - agent.spentBetting}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {agent.role === 'pending' && (
                          <button className="btn-small" onClick={() => handleApprove(agent.id)}>Approve</button>
                        )}
                        <button className="btn-small" onClick={() => setImpersonated(agent.id)}
                          style={agent.id === impersonatedId ? { background: 'var(--accent-color, #3b82f6)', color: '#fff' } : {}}>
                          {agent.id === impersonatedId ? 'Active' : 'Impersonate'}
                        </button>
                        <button className="btn-small" onClick={() => handleCredit(agent.id)}>Credit</button>
                        <button className="btn-small btn-delete" onClick={() => handleDelete(agent.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
