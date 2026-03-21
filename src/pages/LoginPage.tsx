import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { OAuthButtons } from '../components/OAuthButtons';
import { api } from '../lib/api';
import { postLoginPath } from '../lib/postLoginPath';

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

    try {
      initializeFirebaseApp();
      const auth = getFirebaseAuth();
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      const profile = await api.getProfile(user).catch(() => ({}));
      navigate(postLoginPath(profile));
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string };
      let msg = 'An error occurred';

      if (firebaseErr.code === 'auth/email-already-in-use') msg = 'Email already in use';
      else if (firebaseErr.code === 'auth/invalid-email') msg = 'Invalid email address';
      else if (firebaseErr.code === 'auth/weak-password') msg = 'Password is too weak';
      else if (firebaseErr.code === 'auth/user-not-found' || firebaseErr.code === 'auth/wrong-password' || firebaseErr.code === 'auth/invalid-credential') msg = 'Invalid email or password';
      else if (firebaseErr.message) msg = firebaseErr.message;

      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="login-page">
        <div className="container" style={{ maxWidth: 400 }}>
          <h1>Login</h1>
          <OAuthButtons
            onSuccess={async (user) => {
              const profile = await api.getProfile(user).catch(() => ({}));
              navigate(postLoginPath(profile));
            }}
            onError={setError}
          />

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
    </>
  );
}
