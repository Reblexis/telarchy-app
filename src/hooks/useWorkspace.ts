import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth';
import { api, setActiveWorkspace } from '../lib/api';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  /** Role in the current workspace. Null when in the default (platform-level) context. */
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
} {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 'default' is a sentinel meaning "switch back to the platform-level context"
  const switchWorkspace = useCallback((id: string) => {
    setActiveWorkspace(id === 'default' ? null : id);
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!user) { setWorkspace(null); setAllWorkspaces([]); setLoading(false); return; }
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

        const tier: WorkspaceInfo['tier'] = needsWorkspace
          ? 'none'
          : authRole === 'admin'
            ? 'admin'
            : authRole === 'agent'
              ? 'trader'
              : 'viewer';

        setWorkspace({ workspaceId, memberRole, authRole, intent, tier, needsWorkspace });

        const mapped = wsList.map(w => ({ id: w.id, name: w.name, memberRole: w.memberRole }));
        // Admin users with workspaces get a sentinel "Platform" entry so they can switch back
        // to the default (platform-level) context. authRole is used rather than workspaceId
        // since admins can switch into a workspace, at which point workspaceId is no longer 'default'.
        const enriched = (authRole === 'admin' && mapped.length > 0)
          ? [{ id: 'default', name: 'Platform', memberRole: '' }, ...mapped]
          : mapped;
        setAllWorkspaces(enriched);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error('useWorkspace: failed to fetch profile', e.message);
        // Clear stale active workspace that may have caused a 403
        setActiveWorkspace(null);
        setWorkspace({ workspaceId: 'default', memberRole: null, authRole: 'admin', intent: null, tier: 'admin', needsWorkspace: false });
        setAllWorkspaces([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user]);

  return { workspace, allWorkspaces, switchWorkspace, loading };
}
