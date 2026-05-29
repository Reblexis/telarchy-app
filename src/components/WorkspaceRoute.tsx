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
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<'resolving' | 'ready' | 'notfound'>('resolving');

  useEffect(() => {
    if (authLoading || !user || !owner || !slug) return;
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
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('notfound'); });
    return () => { cancelled = true; };
  }, [owner, slug, user, authLoading, location.pathname, location.search, location.hash, navigate]);

  if (authLoading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  if (state === 'notfound') return <Navigate to="/" replace />;
  if (state === 'resolving') return <div className="loading">Loading...</div>;
  return <Outlet />;
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

  if (workspace?.needsWorkspace) {
    if (workspace.intent === 'trader') return <Navigate to="/marketplace" replace />;
    if (workspace.intent === 'agent') return <Navigate to="/api-access" replace />;
    return <Navigate to="/create-workspace" replace />;
  }

  const meta = allWorkspaces.find(w => w.id === workspace?.workspaceId);
  if (meta?.ownerHandle && meta?.slug) {
    const target = `/${encodeURIComponent(meta.ownerHandle)}/${encodeURIComponent(meta.slug)}/${tab}`;
    return <Navigate to={target + window.location.search + window.location.hash} replace />;
  }
  // Active workspace isn't in the member list (e.g. not joined yet): send the
  // user to the marketplace rather than a flat page that no longer exists.
  return <Navigate to="/marketplace" replace />;
}
