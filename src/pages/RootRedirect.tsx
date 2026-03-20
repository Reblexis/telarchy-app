import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirebaseConfig } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

export function RootRedirect() {
  const navigate = useNavigate();
  const config = getFirebaseConfig();
  const { user, loading } = useAuth({ skip: !config });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!config) {
      navigate('/setup', { replace: true });
      return;
    }
    if (loading || checking) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    // Check whether the user has a workspace. Admins resolve to 'default'; new users to nothing.
    setChecking(true);
    api.getProfile(user)
      .then((profile: { workspaceId?: string; workspaces?: Record<string, unknown> }) => {
        // 'default' means platform admin — go straight to dashboard
        if (profile.workspaceId === 'default') {
          navigate('/metrics', { replace: true });
          return;
        }
        const hasWorkspace = profile.workspaces && Object.keys(profile.workspaces).length > 0;
        navigate(hasWorkspace ? '/metrics' : '/create-workspace', { replace: true });
      })
      .catch(() => {
        // On error (e.g. first sign-in before profile exists), go to create-workspace
        navigate('/create-workspace', { replace: true });
      });
  }, [config, user, loading, checking, navigate]);

  return <div className="loading">Loading...</div>;
}
