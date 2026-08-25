/**
 * A stripe across the top of any copy of this app that is NOT the published
 * site (owner ask 2026-08-20: "i think deploying to prod is too easy").
 *
 * Detection is where the page is being served from, never a build flag: the
 * candidate revision and the revision that later serves telarchy.com are the
 * SAME build, so nothing baked in can tell them apart. Two things mean "not
 * the published site":
 *
 *  - the path is under /beta, which is the beta on the real domain, or
 *  - the host is not telarchy.com at all (the candidate's own run.app URL,
 *    a preview, a local dev server).
 *
 * It carries the Publish button itself, because the point of the gate is that
 * the press happens on the thing you just looked at.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

/** The one origin that is the real site. Everything else wears the stripe. */
const PUBLIC_ORIGIN = 'telarchy.com';

export function isPublishedOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  const onPublicHost = h === PUBLIC_ORIGIN || h === `www.${PUBLIC_ORIGIN}`;
  const underBeta = window.location.pathname === '/beta' || window.location.pathname.startsWith('/beta/');
  return onPublicHost && !underBeta;
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
  // Three states, three sentences. Saying "telarchy.com is still serving the
  // previous build" when this IS the published build is a lie the stripe told
  // for one evening (2026-08-20), and the whole point of the stripe is that it
  // is the one thing on the page you can believe about what you are looking at.
  const [waiting, setWaiting] = useState<'unknown' | 'yes' | 'no'>('unknown');
  // Which database this copy of the app is writing to (owner ask 2026-08-20).
  // The stripe says it because "am I about to change the live floor" is the
  // one question a tester must never have to guess at, and because a beta
  // that quietly shares production is exactly what this stripe used to mean.
  const [store, setStore] = useState<'beta' | 'production' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isPublishedOrigin()) return;
    api
      .getPublicConfig()
      .then(c => setStore(c.store === 'beta' ? 'beta' : 'production'))
      .catch(e => console.error('public-config fetch failed:', e));
  }, []);

  useEffect(() => {
    if (isPublishedOrigin()) return;
    // Signed out, there is nobody to offer a button to, and asking would put a
    // 403 in the log for every anonymous pageview.
    if (!user) {
      setCanPublish(false);
      return;
    }
    // Only a platform admin gets the button; everyone else still gets the
    // stripe, because "you are not on the real site" is worth saying to
    // anyone who somehow finds the URL.
    api
      .getRelease()
      .then(r => {
        setCanPublish(!r.isServing);
        setWaiting(r.isServing ? 'no' : 'yes');
      })
      .catch(() => {
        setCanPublish(false);
        setWaiting('unknown');
      });
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
      {/* "data" rather than "database", because only half of it is separate.
          The auth client is pinned to the origin's /api/auth (auth-client.ts),
          which is what makes Google login work on the real domain and is why
          the beta exists at telarchy.com/beta at all; the cost is that
          ACCOUNT writes made here (profile, notification settings, password)
          land in production while every workspace, market and trade lands in
          the beta store. Saying "own database" invites someone to test an
          account feature and change their real one. */}
      {store && (
        <span
          className={`betabar-store${store === 'production' ? ' is-live' : ''}`}
          title={
            store === 'beta'
              ? "Workspaces, markets and trades are the beta's own. Your ACCOUNT is the real one: sign-in, profile and notification changes here are live."
              : 'This build is serving telarchy.com.'
          }
        >
          {store === 'beta' ? 'own data, real account' : 'LIVE database'}
        </span>
      )}
      <span className="betabar-text">
        {note ||
          (waiting === 'yes'
            ? 'Not published. telarchy.com is still serving the previous build.'
            : waiting === 'no'
              ? 'Nothing is waiting. This is the build telarchy.com is serving.'
              : 'The beta build. What telarchy.com serves may differ.')}
      </span>
      {canPublish && !note && (
        <button
          className="betabar-go"
          disabled={busy}
          onClick={() => {
            void publish();
          }}
        >
          {busy ? 'Publishing…' : 'Publish this build'}
        </button>
      )}
      {err && <span className="betabar-err">{err}</span>}
    </div>
  );
}
