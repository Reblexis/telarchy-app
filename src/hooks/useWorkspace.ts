import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth';
import { api, setActiveWorkspace } from '../lib/api';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  /** Role in the current workspace. Null when no workspace is active. */
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

export interface WorkspaceListItem {
  id: string;
  name: string;
  memberRole: string;
}

export function useWorkspace(user: User | null): {
  workspace: WorkspaceInfo | null;
  allWorkspaces: WorkspaceListItem[];
  switchWorkspace: (id: string) => void;
  loading: boolean;
  error: string | null;
} {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const switchWorkspace = useCallback((id: string) => {
    setActiveWorkspace(id);
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!user) { setWorkspace(null); setAllWorkspaces([]); setError(null); setLoading(false); return; }
    let cancelled = false;

    Promise.all([
      api.getProfile(user),
      api.listWorkspaces(user).catch((e: Error) => { console.error('listWorkspaces failed:', e.message); return []; }),
    ])
      .then(([profile, wsList]: [
        { workspaceId?: string; authRole?: string; memberRole?: WorkspaceMemberRole | null; intent?: 'creator' | 'agent' | null },
        Array<{ id: string; name: string; memberRole: string }>,
      ]) => {
        if (cancelled) return;
        const workspaceId = profile.workspaceId ?? 'default';
        const memberRole = profile.memberRole ?? null;
        const authRole = profile.authRole ?? 'pending';
        const intent = profile.intent ?? null;

        const needsWorkspace = authRole === 'pending';

        const tier: WorkspaceInfo['tier'] = (() => {
          if (needsWorkspace) return 'none';
          // memberRole is set when user has an explicit workspace membership
          if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
          if (memberRole === 'trader') return 'trader';
          if (memberRole === 'viewer') return 'viewer';
          // No memberRole — fall back to auth-level role (platform admin / unattached user)
          if (authRole === 'admin') return 'admin';
          if (authRole === 'agent') return 'trader';
          return 'viewer';
        })();

        setError(null);
        setWorkspace({ workspaceId, memberRole, authRole, intent, tier, needsWorkspace });

        const mapped = wsList.map(w => ({ id: w.id, name: w.name, memberRole: w.memberRole }));
        setAllWorkspaces(mapped);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error('useWorkspace: failed to fetch profile', e.message);
        setActiveWorkspace(null);
        setError(e.message);
        setWorkspace(null);
        setAllWorkspaces([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user]);

  return { workspace, allWorkspaces, switchWorkspace, loading, error };
}
