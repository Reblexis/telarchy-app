/**
 * A stripe across the top of any copy of this app that is NOT the published
 * site (owner ask 2026-08-20: "i think deploying to prod is too easy").
 *
 * Detection is the hostname, not a build flag, and that is deliberate: the
 * candidate revision and the revision that later serves telarchy.com are the
 * SAME build, so nothing baked in at build time can tell them apart. Where the
 * page is being served from can. Anything that is not the public origin is not
 * the published site: the beta, a preview URL, a local dev server.
 *
 * It carries the Publish button itself, because the point of the gate is that
 * the press happens on the thing you just looked at.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/** The one origin that is the real site. Everything else wears the stripe. */
const PUBLIC_ORIGIN = 'telarchy.com';

export function isPublishedOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h === PUBLIC_ORIGIN || h === `www.${PUBLIC_ORIGIN}`;
}

export function BetaBanner() {
  // Keyed on the session, not on mount alone. The banner lives outside the
  // router so it never remounts: checked once, it would ask while the visitor
  // is still on the login page, get the 403 it deserves, and never ask again
  // after they signed in. Which is exactly what happened the first time
  // anyone tried to publish (owner report 2026-08-20: "where do i press
  // publish this build?").
  const { user } = useAuth();
  const [canPublish, setCanPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isPublishedOrigin()) return;
    // Signed out, there is nobody to offer a button to, and asking would put a
    // 403 in the log for every anonymous pageview.
    if (!user) { setCanPublish(false); return; }
    // Only a platform admin gets the button; everyone else still gets the
    // stripe, because "you are not on the real site" is worth saying to
    // anyone who somehow finds the URL.
    api.getRelease()
      .then(r => setCanPublish(!r.isServing))
      .catch(() => setCanPublish(false));
  }, [user]);

  if (isPublishedOrigin()) return null;

  const publish = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.publishRelease();
      setNote('Published. telarchy.com is serving this build.');
      setCanPublish(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="betabar" role="status">
      <span className="betabar-label">Beta</span>
      <span className="betabar-text">
        {note || 'Not published. telarchy.com is still serving the previous build.'}
      </span>
      {canPublish && !note && (
        <button className="betabar-go" disabled={busy} onClick={() => { void publish(); }}>
          {busy ? 'Publishing…' : 'Publish this build'}
        </button>
      )}
      {err && <span className="betabar-err">{err}</span>}
    </div>
  );
}
