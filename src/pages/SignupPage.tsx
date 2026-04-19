import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { api } from '../lib/api';
import { OAuthButtons } from '../components/OAuthButtons';

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!agreed) { setError('You must agree to the Terms and Privacy Policy.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    const name = displayName.trim();
    if (!name) { setError('Display name is required'); return; }

    setSubmitting(true);

    const { error: signUpError } = await authClient.signUp.email({ email, password, name });
    if (signUpError) {
      setError(signUpError.message || 'An error occurred');
      setSubmitting(false);
      return;
    }

    await api.recordConsent().catch((e: Error) => {
      console.error('recordConsent failed:', e.message);
    });

    await api.upsertProfile(name).catch((e: Error) => {
      console.error('upsertProfile failed:', e.message);
    });

    setSubmitting(false);
    navigate('/create-workspace');
  };

  const handleOAuthConsentGate = () => {
    if (!agreed) {
      setError('Please agree to the Terms and Privacy Policy before continuing.');
      return false;
    }
    sessionStorage.setItem('pendingConsent', '1');
    return true;
  };

  return (
    <div className="login-page">
      <div className="container" style={{ maxWidth: 400 }}>
        <h1>Create account</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
          1000 free credits on signup. No credit card required.
        </p>

        <OAuthButtons
          onError={setError}
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
            <label htmlFor="displayName">Display name</label>
            <input type="text" id="displayName" required autoComplete="nickname"
              value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required autoComplete="new-password" minLength={8}
              value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', margin: '0.75rem 0 1rem', fontSize: '0.85rem', lineHeight: 1.4 }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: '0.15rem' }} />
            <span>
              I am 18 or older and agree to the{' '}
              <Link to="/terms" target="_blank" rel="noreferrer">Terms</Link>
              {' '}and{' '}
              <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
            </span>
          </label>
          <button type="submit" disabled={submitting || !agreed}>
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
