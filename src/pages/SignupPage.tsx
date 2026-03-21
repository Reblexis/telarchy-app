import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, User } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { api } from '../lib/api';
import { OAuthButtons } from '../components/OAuthButtons';

export function SignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleOAuthSuccess = async (user: User) => {
    await api.upsertProfile(user, user.email ?? undefined);
    navigate('/start');
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

      await api.upsertProfile(user, email);

      navigate('/start');
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
      <div className="login-page">
        <div className="container" style={{ maxWidth: 400 }}>
          <h1>Create account</h1>

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
