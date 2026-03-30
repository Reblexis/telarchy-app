import { useState, useEffect, useCallback } from 'react';
import { api, setActiveWorkspace, setCustomApiUrl } from '../lib/api';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  memberRole: WorkspaceMemberRole | null;
  authRole: string;
  intent: 'creator' | 'agent' | null;
  tier: 'admin' | 'trader' | 'viewer' | 'none';
  needsWorkspace: boolean;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  memberRole: string;
  customApiUrl?: string;
}

export function useWorkspace(authenticated: boolean = true): {
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
    if (!authenticated) { setWorkspace(null); setAllWorkspaces([]); setError(null); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;

    Promise.all([
      api.getProfile(),
      api.listWorkspaces().catch((e: Error) => { console.error('listWorkspaces failed:', e.message); return []; }),
    ])
      .then(([profile, wsList]: [
        { workspaceId?: string; authRole?: string; memberRole?: WorkspaceMemberRole | null; intent?: 'creator' | 'agent' | null },
        Array<{ id: string; name: string; memberRole: string; customApiUrl?: string }>,
      ]) => {
        if (cancelled) return;
        const workspaceId = profile.workspaceId ?? 'default';
        const memberRole = profile.memberRole ?? null;
        const authRole = profile.authRole ?? 'pending';
        const intent = profile.intent ?? null;

        const needsWorkspace = authRole === 'pending';

        const tier: WorkspaceInfo['tier'] = (() => {
          if (needsWorkspace) return 'none';
          if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
          if (memberRole === 'trader') return 'trader';
          if (memberRole === 'viewer') return 'viewer';
          if (authRole === 'admin') return 'admin';
          if (authRole === 'agent') return 'trader';
          return 'viewer';
        })();

        const activeWs = wsList.find(w => w.id === workspaceId);
        setCustomApiUrl(activeWs?.customApiUrl ?? null);

        setError(null);
        setWorkspace({ workspaceId, memberRole, authRole, intent, tier, needsWorkspace });

        const mapped = wsList.map(w => ({ id: w.id, name: w.name, memberRole: w.memberRole, customApiUrl: w.customApiUrl }));
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
  }, [authenticated]);

  return { workspace, allWorkspaces, switchWorkspace, loading, error };
}
