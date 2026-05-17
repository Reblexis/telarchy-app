import { useState, useEffect, useCallback } from 'react';
import { api, setActiveWorkspace } from '../lib/api';
import type { Capability } from '../types';

export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface WorkspaceInfo {
  workspaceId: string;
  memberRole: WorkspaceMemberRole | null;
  authRole: string;
  intent: 'creator' | 'agent' | 'trader' | null;
  tier: 'admin' | 'trader' | 'viewer' | 'none';
  capabilities: Capability[];
  needsWorkspace: boolean;
  platformAdmin: boolean;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  memberRole: string;
}

export function useWorkspace(authenticated: boolean = true): {
  workspace: WorkspaceInfo | null;
  allWorkspaces: WorkspaceListItem[];
  switchWorkspace: (id: string, targetPath?: string) => void;
  loading: boolean;
  error: string | null;
} {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const switchWorkspace = useCallback((id: string, targetPath?: string) => {
    setActiveWorkspace(id);
    // Drop ?proposal=: it points at a proposal in the workspace we're leaving,
    // so inspect mode would otherwise persist into the new workspace.
    const next = new URL(
      targetPath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
      window.location.origin,
    );
    next.searchParams.delete('proposal');
    window.location.href = next.pathname + next.search + next.hash;
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
        { workspaceId?: string; authRole?: string; memberRole?: WorkspaceMemberRole | null; intent?: 'creator' | 'agent' | 'trader' | null; platformAdmin?: boolean; capabilities?: string[] },
        Array<{ id: string; name: string; memberRole: string }>,
      ]) => {
        if (cancelled) return;
        const workspaceId = profile.workspaceId;
        if (workspaceId) setActiveWorkspace(workspaceId);
        const memberRole = profile.memberRole ?? null;
        const authRole = profile.authRole ?? 'pending';
        const intent = profile.intent ?? null;

        const needsWorkspace = authRole === 'pending' || !workspaceId;

        const tier: WorkspaceInfo['tier'] = (() => {
          if (needsWorkspace) return 'none';
          if (memberRole === 'owner' || memberRole === 'admin') return 'admin';
          if (memberRole === 'trader') return 'trader';
          if (memberRole === 'viewer') return 'viewer';
          if (authRole === 'admin') return 'admin';
          if (authRole === 'agent') return 'trader';
          return 'viewer';
        })();

        const KNOWN_CAPS: ReadonlyArray<Capability> = ['read', 'trade', 'manage', 'manage_workspace'];
        const capabilities = (profile.capabilities ?? []).filter(
          (c): c is Capability => (KNOWN_CAPS as readonly string[]).includes(c),
        );

        setError(null);
        setWorkspace({
          workspaceId: workspaceId ?? '',
          memberRole,
          authRole,
          intent,
          tier,
          capabilities,
          needsWorkspace,
          platformAdmin: profile.platformAdmin === true,
        });

        const mapped = wsList.map(w => ({ id: w.id, name: w.name, memberRole: w.memberRole }));
        setAllWorkspaces(mapped);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setWorkspace(null);
        setAllWorkspaces([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [authenticated]);

  return { workspace, allWorkspaces, switchWorkspace, loading, error };
}
