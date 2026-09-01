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

/**
 * True when this floor answers only its owner and its members.
 *
 * `public` is the ONLY value that answers a stranger. Unlisted used to, and
 * a floor is CREATED unlisted, so a founder's confidential KPIs were readable
 * by anyone who guessed the company name the slug is derived from (bug hunt
 * 2026-08-31, P0-7; owner decision 2026-09-01: "unlisted should be same as
 * private ... private but obviously visible to the owner").
 *
 * Unlisted and private differ in intent, not in access: unlisted is the state
 * a floor is born in, private is the state an owner chooses. Every gate that
 * used to read `visibility === 'private'` reads this instead, so the two can
 * never drift apart again. docs/guides/creating.md carries the rule.
 *
 * Asking "is it public?" rather than "is it private?" also fails CLOSED. The
 * column is unconstrained text with a default of 'private', so a value
 * outside the three restricts rather than exposes; the old question let one
 * through (a test fixture had been carrying `visibility: 'open'` for
 * exactly that reason).
 */
export function restrictedToMembers(visibility: string | null | undefined): boolean {
  return visibility !== 'public';
}

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
  // PUBLIC is the only visibility that answers a caller with no identity, and
  // it wins over whatever the groups happen to say.
  if (restrictedToMembers(ws.visibility)) return null;

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
