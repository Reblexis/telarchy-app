import { useEffect, useRef } from 'react';
import { authClient } from '../lib/auth-client';
import { clearCache, clearSessionCache } from '../lib/cache';

export interface AppUser {
  id: string;
  email: string | null | undefined;
  name?: string | null;
}

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();

  const user: AppUser | null = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  const prevUidRef = useRef<string | null>(null);
  useEffect(() => {
    const nextUid = user?.id ?? null;
    const prevUid = prevUidRef.current;
    if (prevUid && prevUid !== nextUid) {
      clearCache();
      clearSessionCache();
    }
    prevUidRef.current = nextUid;
  }, [user?.id]);

  const logout = async () => {
    await authClient.signOut();
  };

  return { user, loading: isPending, logout };
}
