import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAgentSession } from '../hooks/useAgentSession';

export function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Wraps routes that require an active API-key session. Redirects to /agent-login if none. */
export function RequireAgentSession() {
  const { session } = useAgentSession();
  if (!session) return <Navigate to="/agent-login" replace />;
  return <Outlet />;
}

// The old RequireWorkspace guard moved into FlatTabRedirect (components/
// WorkspaceRoute.tsx): the needs-a-workspace redirect now lives where the flat
// tab paths are upgraded to the namespaced /{owner}/{slug}/<tab> URL.
