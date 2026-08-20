import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * `telarchy.com/beta`: the door to the build that is waiting to be published.
 *
 * Owner ask 2026-08-20 ("i think deploying to prod is too easy"). CI lands
 * every green build as a Cloud Run revision carrying no traffic; this page
 * looks up where that revision is answering and sends a platform admin there.
 * Anyone else lands on the market list, the same way an unrecognised URL does,
 * so the page never announces that a beta exists.
 *
 * It is a REDIRECT rather than a path prefix on purpose. The beta is a whole
 * app at its own origin, frontend and API together, so every link inside it
 * already stays on the beta; nothing needs a `/beta` prefix, and the API calls
 * a beta page makes hit the beta's own backend, which is the half that
 * actually carries the risk.
 */
export function BetaPage() {
  const [state, setState] = useState<
    | { kind: 'looking' }
    | { kind: 'denied' }
    | { kind: 'none' }
    | { kind: 'here' }
    | { kind: 'error'; message: string }
  >({ kind: 'looking' });

  useEffect(() => {
    void (async () => {
      let release: Awaited<ReturnType<typeof api.getRelease>>;
      try {
        release = await api.getRelease();
      } catch {
        // 403 for everyone who is not a platform admin, which is most people.
        setState({ kind: 'denied' });
        return;
      }
      if (release.isServing && !release.candidate) { setState({ kind: 'none' }); return; }
      if (!release.candidate) {
        setState(release.error
          ? { kind: 'error', message: 'Cloud Run did not answer, so there is no way to tell what is waiting.' }
          : { kind: 'none' });
        return;
      }
      if (release.running && release.running === release.candidate.revision) {
        setState({ kind: 'here' });
        return;
      }
      if (!release.candidate.url) {
        setState({ kind: 'error', message: 'The waiting revision has no URL of its own to visit.' });
        return;
      }
      window.location.replace(release.candidate.url);
    })();
  }, []);

  if (state.kind === 'denied') return <Navigate to="/" replace />;

  return (
    <div className="pubws pubws--center">
      <nav className="pubws-topbar pubws-topbar--narrow">
        <a className="pubws-wordmark" href="/">Telarchy</a>
      </nav>
      <main className="pubws-main pubws-auth">
        <header className="pubws-hero">
          <h1 className="pubws-name">Beta</h1>
          <p className="pubws-pitch">
            {state.kind === 'looking' && 'Finding the build that is waiting…'}
            {state.kind === 'none' && 'Nothing is waiting. What you are looking at is what is published.'}
            {state.kind === 'here' && 'You are on it. This is the unpublished build.'}
            {state.kind === 'error' && state.message}
          </p>
        </header>
      </main>
    </div>
  );
}
