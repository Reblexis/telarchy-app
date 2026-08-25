/**
 * Attribution: where a participant came from.
 *
 * Contract: docs/agent-economy.md ("Attribution"). A `source` slug is stored on
 * `user` and `agents`; the open-source release is judged on participants whose
 * source is `github` and who actually traded (the "activated participants"
 * number in telarchy/notes/open-source-decision-2026-08-24.md).
 */
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { agents, authUser, trades } from '../db/schema';

export const SOURCE_SLUG = /^[a-z0-9-]{1,32}$/;
export const REF_COOKIE = 'ta_ref';

export function isValidSourceSlug(v: unknown): v is string {
  return typeof v === 'string' && SOURCE_SLUG.test(v);
}

/** The `ta_ref` value from a raw Cookie header, when it is a valid slug; else null. */
export function sourceFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== REF_COOKIE) continue;
    const v = decodeURIComponent(rest.join('=').trim());
    return isValidSourceSlug(v) ? v : null;
  }
  return null;
}

/** Source of the user creating a bot, so the bot inherits it (POST /api/agents). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function creatorSource(tx: any, uid: string | undefined | null): Promise<string | null> {
  if (!uid) return null;
  const [row] = await tx.select({ source: authUser.source }).from(authUser).where(eq(authUser.id, uid));
  return row?.source ?? null;
}

export interface ActivatedQuery {
  source: string;
  /** Inclusive start, exclusive end. */
  start: Date;
  end: Date;
  /** Trades needed in the window (default 3) on at least `minDays` distinct days (default 2). */
  minTrades?: number;
  minDays?: number;
}

export interface ActivatedParticipant {
  agentId: string;
  trades: number;
  days: number;
}

/**
 * Participants attributed to `source` who traded enough in the window to count
 * as activated. Excluded: platform-operated agents (Telarchy's own bots), platform
 * admins themselves, and agents owned by a platform admin (the founder's bots). An agent counts if its own
 * source matches, or if it is the participant identity (authUserId) of a user
 * whose source matches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function activatedParticipants(db: any, q: ActivatedQuery): Promise<ActivatedParticipant[]> {
  const minTrades = q.minTrades ?? 3;
  const minDays = q.minDays ?? 2;
  const users = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.source, q.source));
  const userIds: string[] = users.map((u: { id: string }) => u.id);
  // The founder's participant identities are platform admins; anything they own
  // (by user id or by parent agent) is excluded, as are Telarchy's own bots.
  const adminAgents = await db
    .select({ id: agents.id, authUserId: agents.authUserId })
    .from(agents)
    .where(eq(agents.platformAdmin, true));
  const adminAgentIds: string[] = adminAgents.map((a: { id: string }) => a.id);
  const adminUserIds: string[] = adminAgents
    .map((a: { authUserId: string | null }) => a.authUserId)
    .filter((x: string | null): x is string => Boolean(x));

  const candidates = await db
    .select({
      id: agents.id,
      ownerUserId: agents.ownerUserId,
      ownerAgentId: agents.ownerAgentId,
      platformOperated: agents.platformOperated,
      platformAdmin: agents.platformAdmin,
    })
    .from(agents)
    .where(
      userIds.length > 0
        ? sql`(${agents.source} = ${q.source} OR ${agents.authUserId} IN ${userIds})`
        : eq(agents.source, q.source),
    );
  const eligible: string[] = candidates
    .filter(
      (a: {
        platformOperated: boolean;
        platformAdmin: boolean;
        ownerUserId: string | null;
        ownerAgentId: string | null;
      }) =>
        !a.platformOperated &&
        !a.platformAdmin &&
        !(a.ownerUserId && adminUserIds.includes(a.ownerUserId)) &&
        !(a.ownerAgentId && adminAgentIds.includes(a.ownerAgentId)),
    )
    .map((a: { id: string }) => a.id);
  if (eligible.length === 0) return [];

  const rows = await db
    .select({
      agentId: trades.agentId,
      n: sql<number>`count(*)::int`,
      days: sql<number>`count(distinct date_trunc('day', ${trades.createdAt}))::int`,
    })
    .from(trades)
    .where(and(inArray(trades.agentId, eligible), gte(trades.createdAt, q.start), lt(trades.createdAt, q.end)))
    .groupBy(trades.agentId);

  return rows
    .filter((r: { n: number; days: number }) => r.n >= minTrades && r.days >= minDays)
    .map((r: { agentId: string; n: number; days: number }) => ({ agentId: r.agentId, trades: r.n, days: r.days }))
    .sort((a: ActivatedParticipant, b: ActivatedParticipant) => a.agentId.localeCompare(b.agentId));
}
