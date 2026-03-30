import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

export function RootRedirect() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (loading || checking) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    setChecking(true);
    api.getProfile()
      .then((profile: { authRole?: string }) => {
        navigate(profile.authRole === 'pending' ? '/create-workspace' : '/metrics', { replace: true });
      })
      .catch(() => {
        navigate('/create-workspace', { replace: true });
      });
  }, [user, loading, checking, navigate]);

  return <div className="loading">Loading...</div>;
}
