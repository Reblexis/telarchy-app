import { useEffect, useMemo, useRef } from 'react';
import { authClient } from '../lib/auth-client';
import { setActiveWorkspace } from '../lib/api';
import { clearCache, clearSessionCache } from '../lib/cache';

export interface AppUser {
  id: string;
  email: string | null | undefined;
  name?: string | null;
}

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();

  // Memoize so the object reference is stable across renders.
  // Without this, every render creates a new object, causing useCallback/useEffect
  // deps that include `user` to fire on every render → infinite API call loops.
  const user: AppUser | null = useMemo(
    () => session?.user
      ? { id: session.user.id, email: session.user.email, name: session.user.name }
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.user?.id, session?.user?.email, session?.user?.name],
  );

  const prevUidRef = useRef<string | null>(null);
  useEffect(() => {
    const nextUid = user?.id ?? null;
    const prevUid = prevUidRef.current;
    if (prevUid && prevUid !== nextUid) {
      setActiveWorkspace(null);
      clearCache();
      clearSessionCache();
    }
    prevUidRef.current = nextUid;
  }, [user?.id]);

  const logout = async () => {
    await authClient.signOut();
    setActiveWorkspace(null);
  };

  return { user, loading: isPending, logout };
}
