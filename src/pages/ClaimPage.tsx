import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

interface ClaimInfo {
  participantId: string;
  nickname: string | null;
  workspaces: Array<{ id: string; name: string; slug: string }>;
}

/**
 * /claim?token=... - attach a browser account to a key-first identity created
 * by an onboarding agent via POST /api/onboard. Signed-out visitors are sent
 * through signup/login with the claim path stashed as the next target, so the
 * flow is: open link, sign up (consent happens there), land back here, claim.
 */
export function ClaimPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const token = new URLSearchParams(location.search).get('token') ?? '';

  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!token) { setError('This claim link is missing its token.'); return; }
    api.onboardClaimInfo(token)
      .then(setInfo)
      .catch((err: Error) => setError(err.message || 'Unknown or already-used claim link.'));
  }, [token]);

  const claim = async () => {
    setClaiming(true);
    setError('');
    try {
      const result = await api.onboardClaim(token);
      const handle = info?.nickname ?? result.participantId;
      const first = result.workspaces?.[0];
      navigate(first ? `/${handle}/${first.slug}` : '/start', { replace: true });
    } catch (err) {
      setError((err as Error).message || 'Claim failed.');
      setClaiming(false);
    }
  };

  const nextHere = encodeURIComponent(`/claim?token=${token}`);

  return (
    <div className="login-page">
      <div className="container" style={{ maxWidth: 440 }}>
        <h1>Claim your workspace</h1>
        {error && <p style={{ color: 'var(--error-color, #c0392b)' }}>{error}</p>}
        {!error && !info && <p style={{ color: 'var(--text-secondary)' }}>Checking this claim link...</p>}
        {info && (
          <>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              An agent set Telarchy up for you as <strong>{info.nickname ?? info.participantId}</strong>
              {info.workspaces.length > 0 && (
                <> with {info.workspaces.length === 1
                  ? <>the workspace <strong>{info.workspaces[0].name}</strong></>
                  : <>{info.workspaces.length} workspaces</>}</>
              )}.
              Claiming attaches it to your account so you can use the web dashboard, and tops your
              credits up to the full signup grant. Your agent's API key keeps working.
            </p>
            {loading ? (
              <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
            ) : user ? (
              <button type="button" onClick={claim} disabled={claiming} style={{ width: '100%' }}>
                {claiming ? 'Claiming...' : 'Claim it'}
              </button>
            ) : (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Sign up (or log in) first; you will land back here.
                </p>
                <Link to={`/signup?next=${nextHere}`} className="lp-btn-primary" style={{ display: 'block', textAlign: 'center' }}>
                  Sign up and claim
                </Link>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '0.75rem', textAlign: 'center' }}>
                  Already have an account? <Link to={`/login?next=${nextHere}`}>Log in</Link>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
