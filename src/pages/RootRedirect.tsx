import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirebaseConfig, initializeFirebaseApp } from '../lib/firebase';
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
    if (user) {
      navigate('/metrics', { replace: true });
      return;
    }

    const devEmail = import.meta.env.VITE_DEV_EMAIL;
    const devPassword = import.meta.env.VITE_DEV_PASSWORD;
    if (devEmail && devPassword && !autoLoginAttempted.current) {
      autoLoginAttempted.current = true;
      const auth = getAuth(initializeFirebaseApp());
      signInWithEmailAndPassword(auth, devEmail, devPassword);
      return;
    }

    navigate('/login', { replace: true });
  }, [config, user, loading, navigate]);

  return <div className="loading">Loading...</div>;
}
