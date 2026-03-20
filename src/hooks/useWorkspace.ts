import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { api } from '../lib/api';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  /** Role in the current workspace. Null for platform admins (workspaceId='default'). */
  memberRole: WorkspaceMemberRole | null;
  /**
   * Effective permission tier:
   * - 'admin'  — can create markets, edit metrics, manage members (owner/admin/platform-admin)
   * - 'trader' — can view and trade but not manage
   * - 'viewer' — read-only
   */
  tier: 'admin' | 'trader' | 'viewer';
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
      .then((profile: { workspaceId?: string; authRole?: string; memberRole?: WorkspaceMemberRole | null }) => {
        if (cancelled) return;
        const workspaceId = profile.workspaceId ?? 'default';
        const memberRole = profile.memberRole ?? null;
        const tier: WorkspaceInfo['tier'] =
          workspaceId === 'default' || memberRole === 'owner' || memberRole === 'admin'
            ? 'admin'
            : memberRole === 'trader'
              ? 'trader'
              : 'viewer';
        setWorkspace({ workspaceId, memberRole, tier });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error('useWorkspace: failed to fetch profile', e.message);
        // Fallback: assume admin for existing sessions (backward compat)
        setWorkspace({ workspaceId: 'default', memberRole: null, tier: 'admin' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user]);

  return { workspace, loading };
}
