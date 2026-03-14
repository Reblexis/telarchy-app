import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { initializeFirebaseApp, getFirebaseAuth } from '../lib/firebase';
import { clearCache, clearSessionCache } from '../lib/cache';

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
    const syncCaches = (u: User | null) => {
      const nextUid = u?.uid || '';
      const prevUid = sessionStorage.getItem('authUserUid') || '';
      if (prevUid && prevUid !== nextUid) {
        clearCache();
        clearSessionCache();
      }
      if (nextUid) sessionStorage.setItem('authUserUid', nextUid);
      else sessionStorage.removeItem('authUserUid');
    };
    let resolved = false;
    const resolve = (u: User | null) => {
      if (resolved) return;
      resolved = true;
      syncCaches(u);
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
