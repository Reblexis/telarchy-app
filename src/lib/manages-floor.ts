/**
 * Does this GET /api/auth/me answer say the viewer manages THIS floor?
 *
 * The answer counts only when it is about the floor asked for. Asked about a
 * workspace the viewer is not a member of, the server answers for one they
 * are in (functions/src/middleware/auth.ts, resolveUser), so a trader who owns
 * any workspace of their own comes back with "manage"; a page that believed
 * it drew the owner's Choose and Decline on someone else's floor (Viktor,
 * 2026-09-17). docs/owner-on-the-floor.md, "Who sees the owner's controls".
 */
export function managesFloor(profile: unknown, workspaceId: string | null | undefined): boolean {
  if (!workspaceId || !profile || typeof profile !== 'object') return false;
  const me = profile as { workspaceId?: unknown; capabilities?: unknown };
  return me.workspaceId === workspaceId && Array.isArray(me.capabilities) && me.capabilities.includes('manage');
}
