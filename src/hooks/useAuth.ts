import { useState, useEffect } from 'react';
import { getAuth, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { initializeFirebaseApp } from '../lib/firebase';

interface UseAuthOptions {
  skip?: boolean;
}

export function useAuth(options: UseAuthOptions = {}) {
  const { skip = false } = options;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!skip);

  useEffect(() => {
    if (skip) return;
    const app = initializeFirebaseApp();
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, [skip]);

  const logout = async () => {
    const app = initializeFirebaseApp();
    const auth = getAuth(app);
    await signOut(auth);
  };

  return { user, loading, logout };
}
