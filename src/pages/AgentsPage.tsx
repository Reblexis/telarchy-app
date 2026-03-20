import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { useImpersonation } from '../hooks/useImpersonation';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { Header } from '../components/Header';
import { DarkModeToggle } from '../components/DarkModeToggle';
import type { Agent } from '../types';

// ─── Operator view (agent operators with no workspace) ──────────────────────

interface MyAgent {
  id: string;
  role: string;
  balance: number;
  earnedBetting: number;
  spentBetting: number;
  createdAt?: { _seconds: number } | null;
}

function AgentOperatorPage({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const navigate = useNavigate();
  useDarkMode();

  const [myAgents, setMyAgents] = useState<MyAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentId, setAgentId] = useState('');
  const [newKey, setNewKey] = useState<{ agentId: string; apiKey: string } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const loadMyAgents = useCallback(async () => {
    setLoadingAgents(true);
    const data = await api.getMyAgents(user).catch((e: Error) => { console.error('getMyAgents', e.message); return []; });
    setMyAgents(data);
    setLoadingAgents(false);
  }, [user]);

  useEffect(() => { loadMyAgents(); }, [loadMyAgents]);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    const id = agentId.trim();
    if (!id) return;
    setRegistering(true);
    try {
      const result = await api.registerAgent(user, id);
      setNewKey(result);
      setAgentId('');
      loadMyAgents();
    } catch (err: unknown) {
      setRegisterError((err as Error).message || 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const apiBase = import.meta.env.VITE_API_URL || 'https://api-ksc7usrtbq-uc.a.run.app';

  return (
    <>
      <DarkModeToggle fixed />
      <Header activePage="agents" navMode="operator" actions={
        <button className="logout-btn" onClick={async () => { await user.reload().catch(() => {}); navigate('/login'); }}>
          Logout
        </button>
      } />
      <div className="container">

        {/* My Agents */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>My agents</h2>
          {loadingAgents ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
          ) : myAgents.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No agents registered yet. Register your first agent below.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  {['Agent ID', 'Status', 'Balance', 'Won', 'Spent', 'PnL'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: h === 'Agent ID' || h === 'Status' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myAgents.map(a => {
                  const pnl = a.earnedBetting - a.spentBetting;
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600, fontFamily: 'monospace', fontSize: '0.9rem' }}>{a.id}</td>
                      <td style={{ padding: '0.6rem 0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                          background: a.role === 'agent' ? 'var(--success-bg)' : 'var(--bg-tertiary)',
                          color: a.role === 'agent' ? 'var(--success-text)' : 'var(--text-secondary)',
                        }}>
                          {a.role === 'pending' ? 'awaiting approval' : a.role}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${a.balance}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>${a.earnedBetting}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>${a.spentBetting}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: pnl >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Register new agent */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Register a new agent</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Choose a unique ID for your bot. You'll get an API key to include in its requests. The key is only shown once.
          </p>
          <form onSubmit={handleRegister} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                placeholder="e.g. my-trading-bot"
                value={agentId}
                onChange={e => setAgentId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                pattern="[a-z0-9\-_]+"
                title="Lowercase letters, numbers, hyphens and underscores only"
                required
                style={{ marginBottom: 0 }}
              />
            </div>
            <button type="submit" disabled={registering || !agentId.trim()} style={{ whiteSpace: 'nowrap' }}>
              {registering ? 'Registering…' : 'Register agent'}
            </button>
          </form>
          {registerError && <div className="error show" style={{ marginTop: '0.5rem' }}>{registerError}</div>}

          {newKey && (
            <div style={{
              marginTop: '1rem', padding: '1rem', borderRadius: '0.5rem',
              background: 'var(--success-bg)', border: '1px solid var(--success-text)',
            }}>
              <p style={{ fontWeight: 600, color: 'var(--success-text)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Agent <code>{newKey.agentId}</code> registered. Copy your API key — it won't be shown again.
              </p>
              <code style={{
                display: 'block', padding: '0.6rem 0.75rem',
                background: 'var(--bg-primary)', borderRadius: '0.375rem',
                fontSize: '0.8rem', wordBreak: 'break-all', userSelect: 'all',
                border: '1px solid var(--border-color)',
              }}>
                {newKey.apiKey}
              </code>
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Status: <strong>pending</strong> — a workspace admin must approve your agent before it can trade.
                Browse the <Link to="/marketplace">Marketplace</Link> to find public workspaces to join.
              </p>
              <button className="btn-small" style={{ marginTop: '0.5rem' }} onClick={() => setNewKey(null)}>Dismiss</button>
            </div>
          )}
        </div>

        {/* How to use your agent */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Connecting your bot</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Include the API key in every request using the <code>X-Agent-Key</code> header.
            Your agent must be approved by the workspace admin before it can place trades.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>1. Check balance and available markets</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/agents/<agent-id>/dashboard`}
              </pre>
            </div>

            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>2. Place a trade</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -X POST -H "X-Agent-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"marketId":"<id>","prediction":0.72,"stake":10}' \\
  ${apiBase}/api/predictions/trade`}
              </pre>
            </div>

            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>3. Check your positions</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/predictions/positions`}
              </pre>
            </div>
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Deposit credits: send USDC on Base to the treasury, then call{' '}
            <code>POST /api/agents/&lt;id&gt;/deposit</code> with the tx hash.
            See the full <a href={`${apiBase}/api/help`} target="_blank" rel="noreferrer" style={{ color: 'var(--focus-border)' }}>API reference</a>.
          </p>
        </div>

        {/* Find markets */}
        <div className="section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Find markets to trade</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Browse public workspaces, see active markets, and request to join.
            </p>
          </div>
          <Link to="/marketplace" style={{
            background: 'var(--button-bg)', color: 'var(--button-text)',
            padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
            textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap',
          }}>
            Browse Marketplace →
          </Link>
        </div>
      </div>
    </>
  );
}

// ─── Admin view (workspace owners / admins) ─────────────────────────────────

function AgentAdminPage({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  useDarkMode();
  const { agentId: impersonatedId, setAgentId: setImpersonated } = useImpersonation();
  const [agents, setAgents] = useState<Agent[]>(() => cacheGet<Agent[]>('agents') || []);
  const [loading, setLoading] = useState(!cacheGet('agents'));
  const [error, setError] = useState('');
  const [treasury, setTreasury] = useState<{ address: string; usdcBalance: number; ethBalance: number } | null>(null);

  const loadAgents = useCallback(async () => {
    setError('');
    const [data, treas] = await Promise.all([
      api.getAgents(user).catch((e: Error) => { setError(e.message); return null; }),
      api.getTreasury(user).catch(() => null),
    ]);
    if (data) { setAgents(data); cacheSet('agents', data); }
    if (treas) setTreasury(treas);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleApprove = async (id: string) => { if (!user) return; await api.approveAgent(user, id); loadAgents(); };
  const handleDelete = async (id: string) => { if (!user || !confirm(`Delete agent "${id}"?`)) return; await api.deleteAgent(user, id); loadAgents(); };
  const handleCredit = async (id: string) => {
    if (!user) return;
    const input = prompt('Dollars to add:');
    if (!input) return;
    const amount = Number(input);
    if (!amount || amount <= 0) return;
    await api.creditAgent(user, id, amount, 'Manual credit', impersonatedId);
    loadAgents();
  };
  const handleRoleChange = async (id: string, role: string) => { if (!user) return; await api.setAgentRole(user, id, role); loadAgents(); };

  return (
    <>
      <Header activePage="agents" navMode="creator" actions={
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Acting as: <strong>{impersonatedId}</strong></span>
      } />
      <div className="container">
        {error && <div className="message error show">{error}</div>}
        {treasury && (
          <div className="section" style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Treasury USDC (Base)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>${treasury.usdcBalance.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Treasury ETH (Base)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>{treasury.ethBalance.toFixed(6)} ETH</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Address</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{treasury.address}</div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="loading">Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No agents registered yet.</p></div>
        ) : (
          <div className="section">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  {['Agent', 'Role', 'Balance', 'Gifted', 'Bet Won', 'Bet Spent', 'PnL', 'Actions'].map((h, i) => (
                    <th key={h} style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: i >= 2 && i <= 6 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id} style={{ borderBottom: '1px solid var(--border-color)', background: agent.id === impersonatedId ? 'var(--bg-secondary)' : undefined }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{agent.id}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <select value={agent.role} onChange={e => handleRoleChange(agent.id, e.target.value)}
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', borderRadius: '4px' }}>
                        <option value="pending">pending</option>
                        <option value="agent">agent</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${agent.balance}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>${agent.gifted}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>${agent.earnedBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>${agent.spentBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: agent.earnedBetting - agent.spentBetting >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                      {agent.earnedBetting - agent.spentBetting >= 0 ? '+$' : '-$'}{Math.abs(agent.earnedBetting - agent.spentBetting)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {agent.role === 'pending' && <button className="btn-small" onClick={() => handleApprove(agent.id)}>Approve</button>}
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

// ─── Main export — routes to correct view based on workspace state ───────────

export function AgentsPage() {
  const { user } = useAuth();
  const { workspace, loading } = useWorkspace(user);

  if (!user || loading) return <div className="loading">Loading…</div>;

  if (workspace?.needsWorkspace) {
    return <AgentOperatorPage user={user} />;
  }
  return <AgentAdminPage user={user} />;
}
