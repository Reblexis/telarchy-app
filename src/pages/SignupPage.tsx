import { useState, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, User } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { api } from '../lib/api';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';
import { OAuthButtons } from '../components/OAuthButtons';

type Intent = 'creator' | 'agent';

const INTENT_OPTIONS: { value: Intent; label: string; description: string }[] = [
  { value: 'creator', label: 'I want to make better decisions', description: 'Set goals, create prediction markets around them, and get crowd-backed signals on what actions are worth taking' },
  { value: 'agent',   label: 'I want to trade and earn',        description: 'Bet on outcomes in public markets, or connect an AI bot to trade automatically and earn from correct predictions' },
];

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useDarkMode();

  const [intent, setIntent] = useState<Intent>((params.get('intent') as Intent) || 'creator');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleOAuthSuccess = async (user: User) => {
    await api.upsertProfile(user, user.email ?? undefined, intent);
    navigate(intent === 'creator' ? '/create-workspace' : '/agents');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setSubmitting(true);
    try {
      initializeFirebaseApp();
      const auth = getFirebaseAuth();
      const { user } = await createUserWithEmailAndPassword(auth, email, password);

      await api.upsertProfile(user, email, intent);

      navigate(intent === 'creator' ? '/create-workspace' : '/agents');
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string };
      let msg = 'An error occurred';
      if (firebaseErr.code === 'auth/email-already-in-use') msg = 'Email already in use';
      else if (firebaseErr.code === 'auth/invalid-email') msg = 'Invalid email address';
      else if (firebaseErr.code === 'auth/weak-password') msg = 'Password is too weak (min 6 chars)';
      else if (firebaseErr.message) msg = firebaseErr.message;
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <>
      <DarkModeToggle fixed />
      <div className="login-page">
        <div className="container" style={{ maxWidth: 440 }}>
          <h1>Create account</h1>

          {/* Intent selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1.25rem 0' }}>
            {INTENT_OPTIONS.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  padding: '0.75rem',
                  border: `1px solid ${intent === opt.value ? 'var(--focus-border)' : 'var(--border-color)'}`,
                  borderRadius: '0.375rem',
                  background: intent === opt.value ? 'var(--focus-bg)' : 'var(--bg-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="intent"
                  value={opt.value}
                  checked={intent === opt.value}
                  onChange={() => setIntent(opt.value)}
                  style={{ marginTop: '0.2rem', flexShrink: 0, width: 'auto' }}
                />
                <span>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>{opt.label}</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>{opt.description}</span>
                </span>
              </label>
            ))}
          </div>

          <OAuthButtons onSuccess={handleOAuthSuccess} onError={setError} />

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

          <div className="reconfigure-link">
            Already have an account? <Link to="/login">Log in</Link>
          </div>
        </div>
      </div>
    </>
  );
}
