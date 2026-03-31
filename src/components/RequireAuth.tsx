import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
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

/** Wraps routes that require an active workspace. Redirects to /start if none exists. */
export function RequireWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const { workspace, loading: wsLoading } = useWorkspace(!!user);
  if (authLoading || wsLoading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  if (workspace?.needsWorkspace) return <Navigate to="/start" replace />;
  return <Outlet />;
}
