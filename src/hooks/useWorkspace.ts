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
  /** Owner's URL segment: custom id (nickname) when set, else the owner id. */
  ownerHandle: string | null;
  /** Workspace URL slug, unique per owner. */
  slug: string | null;
}

/**
 * Build a path for a tab in the active workspace. Returns the GitHub-style
 * /{ownerHandle}/{slug}/{tab} when the active workspace's segments are known,
 * otherwise the flat /{tab} (which the flat-route redirector upgrades once the
 * workspace list has loaded). `suffix` is an optional query string / hash,
 * e.g. "?id=123".
 */
export type WsPath = (tab: string, suffix?: string) => string;
/** Namespace a flat tab path string, e.g. "/proposals?id=1" ->
 *  "/{ownerHandle}/{slug}/proposals?id=1". Returns the input unchanged when the
 *  active workspace's segments aren't known yet (flat redirector handles it). */
export type WsHref = (flatPath: string) => string;

export function useWorkspace(authenticated: boolean = true): {
  workspace: WorkspaceInfo | null;
  allWorkspaces: WorkspaceListItem[];
  switchWorkspace: (id: string, targetPath?: string) => void;
  wsPath: WsPath;
  wsHref: WsHref;
  loading: boolean;
  error: string | null;
} {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const switchWorkspace = useCallback((id: string, targetPath?: string) => {
    setActiveWorkspace(id);
    // Navigate to a FLAT path (e.g. /metrics): the active workspace is now the
    // new one, so the flat-route redirector re-namespaces it to the new
    // workspace's /{ownerHandle}/{slug}/... URL. Reusing the current namespaced
    // path would re-encode the workspace we're leaving and the route guard would
    // switch us right back. When no target is given, keep the current tab.
    let flatTarget = targetPath;
    if (!flatTarget) {
      const segs = window.location.pathname.split('/').filter(Boolean);
      // Namespaced path is /:owner/:slug/:tab -> keep the tab; otherwise reuse.
      const tab = segs.length >= 3 ? segs[segs.length - 1] : segs[0];
      flatTarget = tab ? `/${tab}` : '/overview';
    }
    // Drop ?proposal=: it points at a proposal in the workspace we're leaving,
    // so inspect mode would otherwise persist into the new workspace.
    const next = new URL(flatTarget, window.location.origin);
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
        Array<{ id: string; name: string; memberRole: string; ownerHandle?: string | null; slug?: string | null }>,
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

        const mapped = wsList.map(w => ({
          id: w.id, name: w.name, memberRole: w.memberRole,
          ownerHandle: w.ownerHandle ?? null, slug: w.slug ?? null,
        }));
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

  const activeMeta = allWorkspaces.find(w => w.id === workspace?.workspaceId);
  const ownerHandle = activeMeta?.ownerHandle ?? null;
  const slug = activeMeta?.slug ?? null;
  const wsPath = useCallback<WsPath>((tab, suffix = '') => {
    if (ownerHandle && slug) {
      return `/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(slug)}/${tab}${suffix}`;
    }
    return `/${tab}${suffix}`;
  }, [ownerHandle, slug]);
  const wsHref = useCallback<WsHref>((flatPath) => {
    if (!ownerHandle || !slug) return flatPath;
    const m = flatPath.match(/^\/([^/?#]+)(.*)$/);
    if (!m) return flatPath;
    return `/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(slug)}/${m[1]}${m[2]}`;
  }, [ownerHandle, slug]);

  return { workspace, allWorkspaces, switchWorkspace, wsPath, wsHref, loading, error };
}
