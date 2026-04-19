import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { api } from '../lib/api';
import { OAuthButtons } from '../components/OAuthButtons';

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

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

    // Create the participant record (agent + credits). Workspace is created
    // on the next page when the user picks a template.
    await api.upsertProfile(email).catch((e: Error) => {
      console.error('upsertProfile failed:', e.message);
    });

    setSubmitting(false);
    navigate('/create-workspace');
  };

  const handleOAuthConsentGate = () => {
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
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required autoComplete="new-password" minLength={8}
              value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="confirm">Confirm password</label>
            <input type="password" id="confirm" required autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
          {error && <div className="error show">{error}</div>}
        </form>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '1rem', textAlign: 'center', lineHeight: 1.5 }}>
          By creating an account, you confirm you are 18+ and agree to the{' '}
          <Link to="/terms" target="_blank" rel="noreferrer">Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
        </p>

        <div className="reconfigure-link">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
