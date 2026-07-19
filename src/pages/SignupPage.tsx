import { useState, FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { api } from '../lib/api';
import { OAuthButtons } from '../components/OAuthButtons';
import { readNextFromSearch, stashNextPath } from '../lib/nextPath';

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const next = readNextFromSearch(location.search);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    const name = displayName.trim();
    if (!name) { setError('Display name is required'); return; }
    const handle = nickname.trim();
    if (handle && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/.test(handle)) {
      setError('Nickname must be 3–30 chars, letters/digits/-/_, and start with a letter or digit.');
      return;
    }

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

    try {
      await api.upsertProfile(handle ? { nickname: handle } : undefined);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/nickname/i.test(msg)) {
        setError(msg);
        setSubmitting(false);
        return;
      }
      console.error('upsertProfile failed:', msg);
    }

    setSubmitting(false);
    navigate(next ?? '/welcome');
  };

  const handleOAuthConsentGate = () => {
    sessionStorage.setItem('pendingConsent', '1');
    stashNextPath(next);
    return true;
  };

  return (
    <div className="login-page">
      <div className="container" style={{ maxWidth: 400 }}>
        <h1>Create account</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
          Free to start. No credit card required.
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
            <input type="text" id="displayName" required autoComplete="name"
              value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="nickname">Nickname (optional)</label>
            <input type="text" id="nickname" autoComplete="nickname"
              minLength={3} maxLength={30}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,29}"
              placeholder="public handle, must be unique"
              value={nickname} onChange={e => setNickname(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" required autoComplete="new-password" minLength={8}
              value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', lineHeight: 1.4, margin: '0.75rem 0 0' }}>
            By creating an account, you confirm you are 18+ and agree to the{' '}
            <Link to="/terms" target="_blank" rel="noreferrer">Terms</Link>
            {' '}and{' '}
            <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
          </p>
          {error && <div className="error show">{error}</div>}
        </form>

        <div className="reconfigure-link">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
