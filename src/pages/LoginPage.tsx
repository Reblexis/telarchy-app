import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';

export function LoginPage() {
  const navigate = useNavigate();
  useDarkMode();
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
      await signInWithEmailAndPassword(auth, email, password);

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
      <DarkModeToggle fixed />
      <div className="login-page">
        <div className="container" style={{ maxWidth: 400 }}>
          <h1>Login</h1>
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
            <a href="/setup">Reconfigure Firebase</a>
          </div>
        </div>
      </div>
    </>
  );
}
