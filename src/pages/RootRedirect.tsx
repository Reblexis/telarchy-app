import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getFirebaseConfig, initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';

export function RootRedirect() {
  const navigate = useNavigate();
  const config = getFirebaseConfig();
  const { user, loading } = useAuth({ skip: !config });
  const autoLoginAttempted = useRef(false);

  useEffect(() => {
    if (!config) {
      navigate('/setup', { replace: true });
      return;
    }
    if (loading) return;

    // Session found (sessionStorage) — go straight to dashboard.
    if (user) {
      navigate('/metrics', { replace: true });
      return;
    }

    // No session — auto-login with baked-in credentials if available.
    const devEmail = import.meta.env.VITE_DEV_EMAIL;
    const devPassword = import.meta.env.VITE_DEV_PASSWORD;
    if (devEmail && devPassword && !autoLoginAttempted.current) {
      autoLoginAttempted.current = true;
      initializeFirebaseApp();
      signInWithEmailAndPassword(getFirebaseAuth(), devEmail, devPassword)
        .then(() => navigate('/metrics', { replace: true }))
        .catch(() => navigate('/login', { replace: true }));
      return;
    }

    navigate('/login', { replace: true });
  }, [config, user, loading, navigate]);

  return <div className="loading">Loading...</div>;
}
