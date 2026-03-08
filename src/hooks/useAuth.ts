import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';

interface UseAuthOptions {
  skip?: boolean;
}

export function useAuth(options: UseAuthOptions = {}) {
  const { skip = false } = options;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!skip);

  useEffect(() => {
    if (skip) return;
    initializeFirebaseApp();
    const auth = getFirebaseAuth();
    let resolved = false;
    const resolve = (u: User | null) => {
      if (resolved) return;
      resolved = true;
      setUser(u);
      setLoading(false);
    };
    const unsubscribe = onAuthStateChanged(auth, resolve, () => resolve(null));
    // If onAuthStateChanged hangs (stale/invalid stored credentials), sign out
    // to clear them. signOut() itself triggers onAuthStateChanged(null) which
    // calls resolve — self-healing for future page loads too.
    const timeout = setTimeout(() => {
      if (!resolved) signOut(auth).catch(() => resolve(null));
    }, 5000);
    return () => { unsubscribe(); clearTimeout(timeout); };
  }, [skip]);

  const logout = async () => {
    const auth = getFirebaseAuth();
    await signOut(auth);
  };

  return { user, loading, logout };
}
