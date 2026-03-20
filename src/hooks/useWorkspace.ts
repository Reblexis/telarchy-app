import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { api } from '../lib/api';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  /** Role in the current workspace. Null for platform admins (workspaceId='default'). */
  memberRole: WorkspaceMemberRole | null;
  /** Auth role returned by the backend: 'admin' | 'agent' | 'pending' */
  authRole: string;
  /** User's signup intent, stored in their profile: 'creator' | 'agent' | null */
  intent: 'creator' | 'agent' | null;
  /**
   * Effective permission tier:
   * - 'admin'  — can create markets, edit metrics, manage members
   * - 'trader' — can view and trade but not manage
   * - 'viewer' — read-only
   * - 'none'   — no workspace yet, needs to create one
   */
  tier: 'admin' | 'trader' | 'viewer' | 'none';
  /** True when the user is authenticated but has no workspace yet */
  needsWorkspace: boolean;
}

export function useWorkspace(user: User | null): {
  workspace: WorkspaceInfo | null;
  loading: boolean;
} {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setWorkspace(null); setLoading(false); return; }
    let cancelled = false;

    api.getProfile(user)
      .then((profile: { workspaceId?: string; authRole?: string; memberRole?: WorkspaceMemberRole | null; intent?: 'creator' | 'agent' | null }) => {
        if (cancelled) return;
        const workspaceId = profile.workspaceId ?? 'default';
        const memberRole = profile.memberRole ?? null;
        const authRole = profile.authRole ?? 'pending';
        const intent = profile.intent ?? null;

        // A user with no workspace resolves to workspaceId='default' with authRole='pending'.
        // Platform admins also get workspaceId='default' but with authRole='admin'.
        const needsWorkspace = authRole === 'pending';

        const tier: WorkspaceInfo['tier'] = needsWorkspace
          ? 'none'
          : authRole === 'admin'
            ? 'admin'
            : authRole === 'agent'
              ? 'trader'
              : 'viewer';

        setWorkspace({ workspaceId, memberRole, authRole, intent, tier, needsWorkspace });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error('useWorkspace: failed to fetch profile', e.message);
        // On error, assume platform admin (backward compat for existing admin sessions)
        setWorkspace({ workspaceId: 'default', memberRole: null, authRole: 'admin', intent: null, tier: 'admin', needsWorkspace: false });
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user]);

  return { workspace, loading };
}
