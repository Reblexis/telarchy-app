import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { OAuthButtons } from '../components/OAuthButtons';
import { AuthShell, AuthField, AuthOr } from '../components/AuthShell';
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

    // Straight back to trading, never to a dashboard: the floor is the
    // product, and after the console was deleted it is also all there is.
    const home = await tradeHome();
    setSubmitting(false);
    navigate(home);
  };

  return (
    <AuthShell
      title="Log in"
      foot={<>New here? <Link to="/signup">Create an account</Link>.</>}
    >
      <OAuthButtons onError={setError} />
      <AuthOr />
      <form className="pubws-form" onSubmit={handleSubmit}>
        <AuthField
          id="email" label="Email" type="email" required autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)}
        />
        <AuthField
          id="password" label="Password" type="password" required autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)}
        />
        <button className="pubws-cta" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        {error && <p className="pubws-joinerr">{error}</p>}
      </form>
    </AuthShell>
  );
}
