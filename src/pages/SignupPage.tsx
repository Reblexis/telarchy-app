import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { api } from '../lib/api';
import { OAuthButtons } from '../components/OAuthButtons';
import { useAgentSession } from '../hooks/useAgentSession';

export function SignupPage() {
  const navigate = useNavigate();
  const { login: agentLogin } = useAgentSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleProfileResult = (result: { agentId?: string; apiKey?: string }) => {
    if (result.agentId && result.apiKey) {
      agentLogin(result.agentId, result.apiKey);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!consented) { setError('You must confirm you are 18+ and accept the Terms and Privacy Policy'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setSubmitting(true);

    const { error: signUpError } = await authClient.signUp.email({ email, password, name: email });
    if (signUpError) {
      setError(signUpError.message || 'An error occurred');
      setSubmitting(false);
      return;
    }

    await api.recordConsent().catch((e: Error) => {
      console.error('recordConsent failed:', e.message);
    });

    const result = await api.upsertProfile(email).catch((e: Error) => {
      console.error('upsertProfile failed:', e.message);
      return {};
    }) as { agentId?: string; apiKey?: string };
    handleProfileResult(result);
    setSubmitting(false);
    navigate('/start');
  };

  const handleOAuthConsentGate = () => {
    if (!consented) {
      setError('Check the box below to confirm you are 18+ and accept the Terms and Privacy Policy');
      return false;
    }
    sessionStorage.setItem('pendingConsent', '1');
    return true;
  };

  return (
    <div className="login-page">
      <div className="container" style={{ maxWidth: 400 }}>
        <h1>Create account</h1>

        <OAuthButtons
          onError={setError}
          disabled={!consented}
          beforeSignIn={handleOAuthConsentGate}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" required autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required autoComplete="new-password" minLength={8}
              value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="confirm">Confirm password</label>
            <input type="password" id="confirm" required autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={consented}
              onChange={e => setConsented(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              I am 18 or older and I agree to the{' '}
              <Link to="/terms" target="_blank" rel="noreferrer">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
            </span>
          </label>
          <button type="submit" disabled={submitting || !consented}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
          {error && <div className="error show">{error}</div>}
        </form>

        <div className="reconfigure-link">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
