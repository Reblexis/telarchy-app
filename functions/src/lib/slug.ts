import { and, ne, sql } from 'drizzle-orm';
import { workspaceSlugAliases } from '../db/schema';

type DbOrTx = {
  select: (...args: any[]) => any;
};

/**
 * Turn a free-text workspace name into a URL slug: lowercase, runs of
 * non-alphanumeric characters collapse to a single hyphen, leading/trailing
 * hyphens trimmed. Empty results fall back to 'workspace'. Matches the SQL
 * backfill in migration 0034 so runtime and backfilled slugs look the same.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'workspace';
}

/**
 * Pick a slug for `name` that is unique among `ownerKey`'s existing slugs
 * (current and historical, read from workspace_slug_aliases). Appends -2, -3,
 * ... until free. The DB partial unique index is the real guard against races;
 * this just produces a clean candidate.
 *
 * `excludeWorkspaceId` omits a workspace's own alias rows from the taken set so
 * it can reclaim a slug it previously used (e.g. renamed away and back).
 */
export async function uniqueSlugForOwner(
  tx: DbOrTx,
  ownerKey: string,
  name: string,
  excludeWorkspaceId?: string,
): Promise<string> {
  const base = slugify(name);
  const where = excludeWorkspaceId
    ? and(sql`${workspaceSlugAliases.ownerKey} = ${ownerKey}`, ne(workspaceSlugAliases.workspaceId, excludeWorkspaceId))
    : sql`${workspaceSlugAliases.ownerKey} = ${ownerKey}`;
  const rows: Array<{ slug: string }> = await tx
    .select({ slug: workspaceSlugAliases.slug })
    .from(workspaceSlugAliases)
    .where(where);
  const taken = new Set(rows.map(r => r.slug.toLowerCase()));

  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
