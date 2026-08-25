import { useEffect, useMemo, useRef } from 'react';
import { setActiveWorkspace } from '../lib/api';
import { authClient } from '../lib/auth-client';

export interface AppUser {
  id: string;
  email: string | null | undefined;
  name?: string | null;
  /** Avatar URL: set by an OAuth provider at sign-in, or by the account
   *  menu via POST /api/auth/profile { image }. */
  image?: string | null;
  emailVerified?: boolean;
}

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();

  // Memoize so the object reference is stable across renders.
  // Without this, every render creates a new object, causing useCallback/useEffect
  // deps that include `user` to fire on every render → infinite API call loops.
  const user: AppUser | null = useMemo(
    () =>
      session?.user
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            image: session.user.image ?? null,
            emailVerified: session.user.emailVerified,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.user?.id, session?.user?.email, session?.user?.name, session?.user?.image, session?.user?.emailVerified],
  );

  const prevUidRef = useRef<string | null>(null);
  useEffect(() => {
    const nextUid = user?.id ?? null;
    const prevUid = prevUidRef.current;
    if (prevUid && prevUid !== nextUid) {
      setActiveWorkspace(null);
      localStorage.removeItem('inspectProposal');
    }
    prevUidRef.current = nextUid;
  }, [user?.id]);

  const logout = async () => {
    await authClient.signOut();
    setActiveWorkspace(null);
    localStorage.removeItem('inspectProposal');
  };

  return { user, loading: isPending, logout };
}
