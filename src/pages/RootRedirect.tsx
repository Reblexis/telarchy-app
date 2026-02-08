import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirebaseConfig, getConfigFromURL, saveFirebaseConfig } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';

export function RootRedirect() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    // Handle config from URL parameter
    const urlConfig = getConfigFromURL();
    if (urlConfig) {
      saveFirebaseConfig(urlConfig);
      const url = new URL(window.location.href);
      url.searchParams.delete('config');
      window.history.replaceState({}, document.title, url.toString());
    }
  }, []);

  useEffect(() => {
    const config = getFirebaseConfig();
    if (!config) {
      navigate('/setup', { replace: true });
      return;
    }
    if (loading) return;
    if (user) {
      navigate('/metrics', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [user, loading, navigate]);

  return <div className="loading">Loading...</div>;
}
