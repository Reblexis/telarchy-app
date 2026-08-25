import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { permissionGroups, workspaces } from '../db/schema';
import type { Capability } from '../types';

/**
 * Reading a public market needs no key. Acting always does.
 *
 * Owner direction 2026-08-20: "only placing trades or writing comments should
 * require api key... you know the user action stuff". Before this, an agent
 * had to register before it could see what was being traded, while the same
 * numbers were already open under `/api/marketplace/*`: two doors onto one
 * fact, one of them locked, and the locked one was the documented API.
 *
 * This lives outside the auth middleware so it can be tested without loading
 * better-auth's ESM build, and because it is a rule about workspaces rather
 * than about credentials.
 */

/** What an anonymous caller may ever hold. Read, and nothing else, ever. */
export const ANONYMOUS_CAPABILITIES: readonly Capability[] = ['read'];

/**
 * The workspace id, when this id-or-slug names a workspace that answers reads
 * to anyone, or null.
 *
 * A slug counts, because someone arriving from a shared link has a slug long
 * before they have an id.
 */
export async function resolvePublicReadWorkspace(idOrSlug: string): Promise<string | null> {
  if (!idOrSlug) return null;
  const [ws] = await db
    .select({ id: workspaces.id, visibility: workspaces.visibility })
    .from(workspaces)
    .where(or(eq(workspaces.id, idOrSlug), sql`lower(${workspaces.slug}) = lower(${idOrSlug})`))
    .limit(1);
  if (!ws) return null;
  // Private is the owner's own statement about who this is for, and it wins
  // over whatever the groups happen to say.
  if (ws.visibility === 'private') return null;

  const [publicGroup] = await db
    .select({ capabilities: permissionGroups.capabilities })
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
  const caps = (publicGroup?.capabilities as string[] | null) ?? [];
  return caps.includes('read') ? ws.id : null;
}

/**
 * The capability set an anonymous caller gets on such a workspace.
 *
 * Deliberately NOT the Public group's own capabilities. An Open workspace
 * grants `trade` there, which is what makes a self-join enough to trade, and
 * handing that to someone with no identity would mean a trade with no account
 * to debit and a comment with no author. So: read, whatever the group says.
 */
export function anonymousCapabilities(): Set<Capability> {
  return new Set<Capability>(ANONYMOUS_CAPABILITIES);
}
