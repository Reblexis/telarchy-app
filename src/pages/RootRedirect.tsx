import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirebaseConfig } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';

export function RootRedirect() {
  const navigate = useNavigate();
  const config = getFirebaseConfig();
  const { user, loading } = useAuth({ skip: !config });

  useEffect(() => {
    if (!config) {
      navigate('/setup', { replace: true });
      return;
    }
    if (loading) return;

    // Existing session found — go straight to dashboard.
    if (user) {
      navigate('/metrics', { replace: true });
      return;
    }

    navigate('/login', { replace: true });
  }, [config, user, loading, navigate]);

  return <div className="loading">Loading...</div>;
}
