import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { agentApi } from '../lib/api';
import { useAgentSession } from '../hooks/useAgentSession';
import { Header } from '../components/Header';

type Tab = 'login' | 'register';

export function AgentLoginPage() {
  const navigate = useNavigate();
  const { login } = useAgentSession();
  const [tab, setTab] = useState<Tab>('login');

  // Login state
  const [loginId, setLoginId] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Register state
  const [registerId, setRegisterId] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newCreds, setNewCreds] = useState<{ agentId: string; apiKey: string } | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const id = loginId.trim();
    const key = loginKey.trim();
    if (!id || !key) return;
    setLoggingIn(true);
    try {
      await agentApi.getProfile(id, key);
      login(id, key);
      navigate('/agent');
    } catch (err: unknown) {
      setLoginError((err as Error).message || 'Invalid agent ID or API key');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    const id = registerId.trim();
    if (!id) return;
    setRegistering(true);
    try {
      const result = await agentApi.register(id);
      setNewCreds(result);
      setRegisterId('');
    } catch (err: unknown) {
      setRegisterError((err as Error).message || 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const handleLoginWithNewCreds = () => {
    if (!newCreds) return;
    login(newCreds.agentId, newCreds.apiKey);
    navigate('/agent');
  };

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '0.5rem 1.25rem',
    fontWeight: tab === t ? 600 : 400,
    color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: 'none',
    border: 'none',
    borderBottom: tab === t ? '2px solid var(--focus-border)' : '2px solid transparent',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'color 0.15s, border-color 0.15s',
    borderRadius: '6px 6px 0 0',
  });

  return (
    <>
      <Header navMode="agent" />
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="section">
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.25rem' }}>API Key Portal</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Log in with a participant API key, or register a new API-only participant.
          </p>

          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
            <button style={tabStyle('login')} onClick={() => setTab('login')}>Log in</button>
            <button style={tabStyle('register')} onClick={() => setTab('register')}>Register</button>
          </div>

          {tab === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  Agent ID
                </label>
                <input
                  type="text"
                  placeholder="my-trading-bot"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  required
                  style={{ marginBottom: 0 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  API Key
                </label>
                <input
                  type="password"
                  placeholder="mtrk_…"
                  value={loginKey}
                  onChange={e => setLoginKey(e.target.value)}
                  required
                  style={{ marginBottom: 0, fontFamily: 'monospace' }}
                />
              </div>
              {loginError && <div className="error show">{loginError}</div>}
              <button type="submit" disabled={loggingIn || !loginId.trim() || !loginKey.trim()}>
                {loggingIn ? 'Verifying…' : 'Log in'}
              </button>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Are you a workspace admin?{' '}
                <Link to="/login" style={{ color: 'var(--focus-border)' }}>Log in here</Link>
              </p>
            </form>
          )}

          {tab === 'register' && !newCreds && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Choose a unique ID for your agent. You'll receive an API key - store it securely, it's shown only once.
              </p>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  Agent ID
                </label>
                <input
                  type="text"
                  placeholder="my-trading-bot"
                  value={registerId}
                  onChange={e => setRegisterId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  pattern="[a-z0-9\-_]+"
                  title="Lowercase letters, numbers, hyphens and underscores only"
                  required
                  style={{ marginBottom: 0 }}
                />
              </div>
              {registerError && <div className="error show">{registerError}</div>}
              <button type="submit" disabled={registering || !registerId.trim()}>
                {registering ? 'Registering…' : 'Register agent'}
              </button>
            </form>
          )}

          {tab === 'register' && newCreds && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '1rem', borderRadius: '0.5rem', background: 'var(--success-bg)', border: '1px solid var(--success-text)' }}>
                <p style={{ fontWeight: 600, color: 'var(--success-text)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Agent <code>{newCreds.agentId}</code> registered successfully.
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Copy your API key now - it will not be shown again.
                </p>
                <code style={{
                  display: 'block', padding: '0.6rem 0.75rem',
                  background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
                  fontSize: '0.8rem', wordBreak: 'break-all', userSelect: 'all',
                  border: '1px solid var(--border-color)', marginBottom: '0.75rem',
                }}>
                  {newCreds.apiKey}
                </code>
                <button onClick={handleLoginWithNewCreds} style={{ width: '100%' }}>
                  Continue to API Key Portal →
                </button>
              </div>
              <button
                className="btn-secondary"
                onClick={() => setNewCreds(null)}
                style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
              >
                Register another agent
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
