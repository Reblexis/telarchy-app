import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthField, AuthOr, AuthShell } from '../components/AuthShell';
import { OAuthButtons } from '../components/OAuthButtons';
import { authClient } from '../lib/auth-client';
import { readNextFromSearch, stashNextPath } from '../lib/nextPath';
import { tradeHome } from '../lib/tradeHome';

export function LoginPage() {
  const navigate = useNavigate();
  // Where they were when they were asked to log in. Signup has honoured this
  // since it existed; login did not, so anyone sent here from a market, a
  // season entry or a half-finished setup was dropped at the trade home
  // instead of back where they were (owner direction 2026-08-24).
  const location = useLocation();
  const next = readNextFromSearch(location.search);
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

    // Back where they were if they were sent here from somewhere, and
    // otherwise straight to trading, never to a dashboard: the market is the
    // product, and after the console was deleted it is also all there is.
    const home = next ?? (await tradeHome());
    setSubmitting(false);
    // The beta is another bundle under /beta (docs/infra/deploy.md): a
    // client-side navigate there would land on this bundle's floor fallback.
    if (home === '/beta' || home.startsWith('/beta/')) {
      window.location.assign(home);
      return;
    }
    navigate(home);
  };

  return (
    <AuthShell
      title="Log in"
      foot={
        <>
          New here? <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>Create an account</Link>.
        </>
      }
    >
      {/* An OAuth round trip leaves the page, so the return path has to
          outlive it: the same stash signup uses. */}
      <OAuthButtons
        onError={setError}
        beforeSignIn={() => {
          stashNextPath(next);
          return true;
        }}
      />
      <AuthOr />
      <form className="pubws-form" onSubmit={handleSubmit}>
        <AuthField
          id="email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <button className="pubws-cta" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        {error && <p className="pubws-joinerr">{error}</p>}
      </form>
    </AuthShell>
  );
}
