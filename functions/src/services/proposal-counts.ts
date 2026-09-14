import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { proposals } from '../db/schema';

/**
 * How far a floor's proposal counts go (docs/infra/deploy.md, "Counts stop at
 * a cap"). A count at the cap means at least that many. The floor payload and
 * the public listing count 30 days of proposals per status on every load, and
 * a floor that decides a proposal a second holds 2.6 million of them in 30
 * days (telarchy umbrella, notes/chess-play-now-load-plan-2026-09-14.md), so
 * each count is an index range read that stops at the cap instead.
 */
export const PROPOSAL_COUNT_CAP = 10_000;

/**
 * How many pending proposals a list that stands for a floor carries before
 * its decided ones (docs/infra/deploy.md, "A list never hides a live
 * proposal").
 */
export const PENDING_LISTED_MAX = 200;

export interface ProposalStatusCounts {
  total: number;
  approved: number;
  declined: number;
  declinedSpam: number;
  withdrawn: number;
  pending: number;
}

/** Every status but `removed`, which is off the board for everyone. */
const COUNTED_STATUSES = ['pending', 'approved', 'declined', 'declined_spam', 'withdrawn', 'lapsed'] as const;

/**
 * Proposals created since `since`, per workspace and status, each count
 * stopping at `cap`. One statement however many workspaces are asked for (the
 * public listing asks for all of them): for every (workspace, status) a
 * lateral range read on proposals (workspace_id, status, created_at) that
 * stops at the cap. Every workspace asked for is in the answer, zeros
 * included.
 */
export async function countProposalStatuses(
  workspaceIds: string[],
  since: Date,
  cap = PROPOSAL_COUNT_CAP,
): Promise<Map<string, ProposalStatusCounts>> {
  const out = new Map<string, ProposalStatusCounts>();
  for (const id of workspaceIds)
    out.set(id, { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 });
  if (workspaceIds.length === 0) return out;
  const result = (await db.execute(sql`
    select w.id as "workspaceId", s.status as "status", c.n as "n"
    from unnest(array[${sql.join(
      workspaceIds.map(id => sql`${id}`),
      sql`, `,
    )}]::text[]) as w(id)
    cross join unnest(array[${sql.join(
      COUNTED_STATUSES.map(st => sql`${st}`),
      sql`, `,
    )}]::text[]) as s(status)
    cross join lateral (
      select count(*)::int as n
      from (
        select 1
        from proposals p
        where p.workspace_id = w.id and p.status = s.status and p.created_at >= ${since}
        limit ${cap}
      ) capped
    ) c
    where c.n > 0
  `)) as unknown as { rows?: Array<{ workspaceId: string; status: string; n: number }> };
  for (const row of result.rows ?? []) {
    const s = out.get(row.workspaceId);
    if (!s) continue;
    const n = Number(row.n) || 0;
    s.total += n;
    if (row.status === 'approved') s.approved += n;
    else if (row.status === 'declined') s.declined += n;
    else if (row.status === 'declined_spam') s.declinedSpam += n;
    else if (row.status === 'withdrawn') s.withdrawn += n;
    else if (row.status === 'pending') s.pending += n;
  }
  return out;
}

/** A workspace's proposals of every status but `removed`, counted up to `cap`. */
export async function countProposalsUpTo(workspaceId: string, cap = PROPOSAL_COUNT_CAP): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(
    db
      .select({ one: sql`1`.as('one') })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), sql`${proposals.status} <> 'removed'`))
      .limit(cap)
      .as('capped'),
  );
  return Number(row?.n) || 0;
}
