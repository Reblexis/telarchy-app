import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthField, AuthOr, AuthShell } from '../components/AuthShell';
import { OAuthButtons } from '../components/OAuthButtons';
import { api } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { readNextFromSearch, stashNextPath } from '../lib/nextPath';
import { readRefCookie } from '../lib/ref';
import { tradeHome } from '../lib/tradeHome';

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const next = readNextFromSearch(location.search);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setError('Display name is required');
      return;
    }

    setSubmitting(true);

    // Attribution: the ?ref= slug the landing stored (src/lib/ref.ts), if any.
    const source = readRefCookie();
    const { error: signUpError } = await authClient.signUp.email({
      email,
      password,
      name,
      ...(source ? { source } : {}),
    } as Parameters<typeof authClient.signUp.email>[0]);
    if (signUpError) {
      setError(signUpError.message || 'An error occurred');
      setSubmitting(false);
      return;
    }

    await api.recordConsent().catch((e: Error) => {
      console.error('recordConsent failed:', e.message);
    });

    // No nickname question at signup (trader-first): the participant row is
    // provisioned with defaults; a public handle is set later from the
    // account dialog on the floor.
    await api.upsertProfile().catch((e: Error) => console.error('upsertProfile failed:', e.message));

    const home = next ?? (await tradeHome());
    setSubmitting(false);
    navigate(home);
  };

  const handleOAuthConsentGate = () => {
    sessionStorage.setItem('pendingConsent', '1');
    stashNextPath(next);
    return true;
  };

  return (
    <AuthShell
      title="Create an account"
      lead="Free, and you can trade the moment you are in."
      foot={
        <>
          Already have one? <Link to="/login">Log in</Link>.
        </>
      }
    >
      <OAuthButtons onError={setError} beforeSignIn={handleOAuthConsentGate} />
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
        {/* Trader-first: no nickname question at signup. Two identity fields
            read as a quiz; the public handle is set later by whoever wants
            one. */}
        <AuthField
          id="displayName"
          label="Display name"
          type="text"
          required
          autoComplete="name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <button className="pubws-cta" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="pubws-fineprint">
          By creating an account you confirm you are 18+ and agree to the{' '}
          <Link to="/terms" target="_blank" rel="noreferrer">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" target="_blank" rel="noreferrer">
            Privacy Policy
          </Link>
          .
        </p>
        {error && <p className="pubws-joinerr">{error}</p>}
      </form>
    </AuthShell>
  );
}
