import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, setActiveWorkspace } from '../lib/api';

/**
 * Guards the namespaced workspace routes (/:owner/:slug/<tab>). Resolves the
 * owner+slug path segments to a workspace id via GET /api/workspaces/resolve,
 * makes that the active workspace (so child pages send the right
 * X-Workspace-Id), and replaces the URL with the canonical segments when an old
 * (renamed-away) slug was used. The workspace lives in the URL here, so two
 * tabs can hold two different workspaces without clobbering each other.
 */
export function WorkspaceRouteGuard() {
  const { owner, slug } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { allWorkspaces, loading: wsLoading } = useWorkspace(!!user);
  const navigate = useNavigate();
  const location = useLocation();
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [state, setState] = useState<'resolving' | 'ready' | 'notfound'>('resolving');

  // The guard stays mounted while switching between workspaces (same route
  // pattern), so the membership list is already loaded and most switches
  // resolve here instantly with no network call and no loading flash.
  const local = allWorkspaces.find(w =>
    !!w.ownerHandle && !!w.slug &&
    w.ownerHandle.toLowerCase() === (owner ?? '').toLowerCase() &&
    w.slug.toLowerCase() === (slug ?? '').toLowerCase(),
  );

  useEffect(() => {
    if (authLoading || !user || !owner || !slug) return;
    // Fast path: the URL points at a workspace the user belongs to.
    if (local) {
      setActiveWorkspace(local.id);
      setResolvedId(local.id);
      setState('ready');
      return;
    }
    // Not in the membership list: it may be a public workspace, an old
    // (renamed-away) slug, or the list is still loading. Wait for the list,
    // then ask the server.
    if (wsLoading) { setState('resolving'); return; }
    let cancelled = false;
    setState('resolving');
    api.resolveWorkspacePath(owner, slug)
      .then(r => {
        if (cancelled) return;
        setActiveWorkspace(r.workspaceId);
        if (r.moved && (r.canonicalOwner !== owner || r.canonicalSlug.toLowerCase() !== slug.toLowerCase())) {
          // Old slug (post-rename): swap the first two path segments for the
          // canonical ones, keep the tab, query and hash.
          const rest = location.pathname.split('/').filter(Boolean).slice(2);
          const next = `/${encodeURIComponent(r.canonicalOwner)}/${encodeURIComponent(r.canonicalSlug)}/${rest.join('/')}`;
          navigate(next + location.search + location.hash, { replace: true });
          return;
        }
        setResolvedId(r.workspaceId);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('notfound'); });
    return () => { cancelled = true; };
  }, [owner, slug, user, authLoading, wsLoading, local?.id, location.pathname, location.search, location.hash, navigate]);

  if (authLoading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  if (state === 'notfound') return <Navigate to="/" replace />;
  if (state === 'resolving' || !resolvedId) return <div className="loading">Loading...</div>;
  // Key the routed content by workspace id so switching workspaces remounts the
  // page (and its data fetches) instead of leaving stale content. display:contents
  // keeps the wrapper out of the layout so page styling is unaffected.
  return <div style={{ display: 'contents' }} key={resolvedId}><Outlet /></div>;
}

/**
 * Renders at the legacy flat tab paths (/metrics, /markets, ...). Upgrades them
 * to the canonical /{ownerHandle}/{slug}/<tab> URL of the active workspace, and
 * preserves the old RequireWorkspace redirects for users who don't have one yet.
 * Keeps old bookmarks and any not-yet-migrated internal link working.
 */
export function FlatTabRedirect({ tab }: { tab: string }) {
  const { user, loading: authLoading } = useAuth();
  const { workspace, allWorkspaces, loading: wsLoading } = useWorkspace(!!user);

  if (authLoading || wsLoading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;

  // Only treat the user as workspace-less when they genuinely have none. A
  // freshly switched-to workspace can momentarily report needsWorkspace before
  // the profile settles; if the list has any workspace, send them to it rather
  // than bouncing to the marketplace.
  if (allWorkspaces.length === 0) {
    if (workspace?.intent === 'trader') return <Navigate to="/marketplace" replace />;
    if (workspace?.intent === 'agent') return <Navigate to="/api-access" replace />;
    // Brand-new owners get the cinematic first-run canvas, which itself
    // creates the workspace and calibrates it before handing off.
    return <Navigate to="/welcome" replace />;
  }

  // Prefer the active workspace; fall back to the first one the user belongs to.
  const meta = allWorkspaces.find(w => w.id === workspace?.workspaceId) ?? allWorkspaces[0];
  if (meta?.ownerHandle && meta?.slug) {
    const target = `/${encodeURIComponent(meta.ownerHandle)}/${encodeURIComponent(meta.slug)}/${tab}`;
    return <Navigate to={target + window.location.search + window.location.hash} replace />;
  }
  // A workspace with no resolvable owner handle/slug should not exist after the
  // backfill; surface the marketplace rather than a dead flat page.
  return <Navigate to="/marketplace" replace />;
}
