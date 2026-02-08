import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeFirebaseApp } from '../lib/firebase';
import { useDarkMode } from '../hooks/useDarkMode';

export function LoginPage() {
  const navigate = useNavigate();
  const { isDark, toggle } = useDarkMode();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const app = initializeFirebaseApp();
      const auth = getAuth(app);

      if (isSignUp) {
        if (password !== confirmPassword) throw new Error('Passwords do not match');
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      navigate('/metrics');
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
      <button className="dark-mode-toggle" onClick={toggle} title="Toggle dark mode" style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000 }}>
        {isDark ? '☀️' : '🌙'}
      </button>
      <div className="login-page">
        <div className="container" style={{ maxWidth: 400 }}>
          <h1>{isSignUp ? 'Sign Up' : 'Login'}</h1>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input type="email" id="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input type="password" id="password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {isSignUp && (
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input type="password" id="confirmPassword" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
            )}
            <button type="submit" disabled={submitting}>
              {submitting ? (isSignUp ? 'Signing up...' : 'Logging in...') : (isSignUp ? 'Sign Up' : 'Login')}
            </button>
            {error && <div className="error show">{error}</div>}
          </form>
          <div className="toggle-mode">
            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>
              {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign up"}
            </button>
          </div>
          <div className="reconfigure-link">
            <a href="/setup">Reconfigure Firebase</a>
          </div>
        </div>
      </div>
    </>
  );
}
