import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents } from '../db/schema';

/**
 * True if the caller is the master key OR a platform admin.
 *
 * Platform-wide authority, distinct from workspace capabilities: a workspace
 * owner has 'manage' inside their own workspace and none of this. Lives here
 * rather than inside one route file because more than one route now asks the
 * question (admin dashboards, and prize-season settlement, which assigns real
 * money and must not be reachable from a workspace role).
 */
export async function isPlatformAuthorized(req: { auth?: { isMasterKey?: boolean; uid?: string } }): Promise<boolean> {
  if (!req.auth) return false;
  if (req.auth.isMasterKey) return true;
  if (!req.auth.uid) return false;
  const [agent] = await db
    .select({ platformAdmin: agents.platformAdmin })
    .from(agents)
    .where(eq(agents.authUserId, req.auth.uid));
  return agent?.platformAdmin === true;
}
