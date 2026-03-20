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

    // authRole='pending' means no workspace yet; 'admin'/'agent' means they can access the dashboard.
    setChecking(true);
    api.getProfile(user)
      .then((profile: { authRole?: string }) => {
        navigate(profile.authRole === 'pending' ? '/create-workspace' : '/metrics', { replace: true });
      })
      .catch(() => {
        // On error (e.g. brand-new user before profile doc exists) go to create-workspace.
        navigate('/create-workspace', { replace: true });
      });
  }, [config, user, loading, checking, navigate]);

  return <div className="loading">Loading...</div>;
}
