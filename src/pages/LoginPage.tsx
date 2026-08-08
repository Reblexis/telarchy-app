import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { OAuthButtons } from '../components/OAuthButtons';
import { api } from '../lib/api';
import { tradeHome } from '../lib/tradeHome';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const { error: authError } = await authClient.signIn.email({ email, password });
    if (authError) {
      setError(authError.message || 'Invalid email or password');
      setSubmitting(false);
      return;
    }

    const profile = await api.getProfile().catch(() => ({}));
    setSubmitting(false);
    navigate(await tradeHome());
  };

  return (
    <div className="login-page">
      <div className="container" style={{ maxWidth: 400 }}>
        <h1>Login</h1>
        <OAuthButtons onError={setError} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Logging in...' : 'Login'}
          </button>
          {error && <div className="error show">{error}</div>}
        </form>
        <div className="reconfigure-link">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
