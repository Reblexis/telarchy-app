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
import { withBase } from '../lib/base-path';

/** The one origin that is the real site. Everything else wears the stripe. */
const PUBLIC_ORIGIN = 'telarchy.com';

function onPublicHost(): boolean {
  const h = window.location.hostname;
  return h === PUBLIC_ORIGIN || h === `www.${PUBLIC_ORIGIN}`;
}

function underBetaPath(): boolean {
  return window.location.pathname === '/beta' || window.location.pathname.startsWith('/beta/');
}

export function isPublishedOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  return onPublicHost() && !underBetaPath();
}

/** telarchy.com/beta itself, where `?branch=` is answered by the published
 *  revision and so the picker can do something. On a revision's direct URL
 *  the choice has nobody to make it. */
function onRealDomainBeta(): boolean {
  if (typeof window === 'undefined') return false;
  return onPublicHost() && underBetaPath();
}

/** The branch a `br-` tag names, for the stripe. */
export function previewLabel(tag: string): string {
  return tag.startsWith('br-') ? tag.slice(3) : tag;
}

/** The `?branch=` link that switches telarchy.com/beta to a build. */
function chooseBuild(tag: string): void {
  window.location.assign(withBase(`/?branch=${encodeURIComponent(tag)}`));
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
  // Which build this is: the `br-` tag of a branch preview, or null for the
  // main candidate (docs/infra/deploy.md, "Branch previews"). A preview never
  // offers Publish: it reaches telarchy.com by merging to main, and the
  // server refuses anyway; the stripe just does not pretend.
  const [preview, setPreview] = useState<string | null>(null);
  // The previews CI has up, for the picker. Admin only (it comes with the
  // release, and without the list there is nothing to pick from), and only
  // where choosing works.
  const [previews, setPreviews] = useState<Array<{ tag: string }>>([]);
  // Every branch of the repository, built or not: an unbuilt one can be
  // built from here (docs/infra/deploy.md, "Any branch can be built").
  const [branches, setBranches] = useState<Array<{ name: string; tag: string | null; built: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isPublishedOrigin()) return;
    api
      .getPublicConfig()
      .then(c => {
        setStore(c.store === 'beta' ? 'beta' : 'production');
        setPreview(c.preview ?? null);
      })
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
        setPreviews(r.previews ?? []);
        // Only once the release answered: that is the admin check, and the
        // branch list is admin only for the same reason.
        api
          .getBranches()
          .then(b => setBranches(b.branches))
          .catch(e => console.error('branches fetch failed:', e));
      })
      .catch(() => {
        setCanPublish(false);
        setWaiting('unknown');
      });
  }, [user]);

  const isPreview = preview !== null;
  const canPick = onRealDomainBeta() && (previews.length > 0 || branches.length > 0);
  // Built previews first (by tag, whether or not their branch still exists),
  // then every branch that is not built, which picking asks CI to build.
  const builtTags = new Set(previews.map(p => p.tag));
  const labelOf = (tag: string) => branches.find(b => b.tag === tag)?.name ?? previewLabel(tag);
  const unbuilt = branches.filter(b => b.tag && !builtTags.has(b.tag));

  const build = async (name: string) => {
    setErr('');
    setNote('');
    try {
      await api.buildBranch(name);
      setNote(`Building ${name}. About eight minutes; it appears here as built when done.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the build');
    }
  };

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
      {isPreview && (
        <span className="betabar-branch" title={`Branch preview, tag ${preview}`}>
          branch {previewLabel(preview)}
        </span>
      )}
      {canPick && (
        <select
          className="betabar-pick"
          aria-label="Which build the beta shows"
          value={preview ?? 'candidate'}
          onChange={e => {
            const v = e.target.value;
            if (v.startsWith('build:')) void build(v.slice('build:'.length));
            else chooseBuild(v);
          }}
        >
          <option value="candidate">main candidate</option>
          {previews.map(p => (
            <option key={p.tag} value={p.tag}>
              {labelOf(p.tag)}
            </option>
          ))}
          {isPreview && !previews.some(p => p.tag === preview) && (
            <option value={preview}>{previewLabel(preview)}</option>
          )}
          {unbuilt.map(b => (
            <option key={b.name} value={`build:${b.name}`}>
              {b.name} (not built, pick to build)
            </option>
          ))}
        </select>
      )}
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
          (isPreview
            ? 'A branch preview. It reaches telarchy.com by merging to main.'
            : waiting === 'yes'
              ? 'Not published. telarchy.com is still serving the previous build.'
              : waiting === 'no'
                ? 'Nothing is waiting. This is the build telarchy.com is serving.'
                : 'The beta build. What telarchy.com serves may differ.')}
      </span>
      {canPublish && !isPreview && !note && (
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
