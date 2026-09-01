/**
 * How many participants register and then never trade, and how long the ones
 * who do take about it.
 *
 * The platform already counts the entrance (`agents.source` tags where a
 * registration came from) and the far end (`weeklyActiveVerifiedTraders`).
 * Nothing counted the step between, which is the step where they are actually
 * lost: 225 registered participants against four weekly active verified
 * traders is the whole question, and no measure answered it.
 *
 * Three rules decide whether this number means anything:
 *
 * 1. CENSORING. A cohort is only the participants who have had the entire
 *    window. Someone who registered an hour ago has not failed to trade, and
 *    counting them as a failure makes the rate move with signup volume rather
 *    than with the experience. They are reported as `censored` and left out of
 *    both the numerator and the denominator.
 * 2. A redemption is not a trade. `trades.kind` distinguishes them at its
 *    definition site because a redemption moves no price and has no
 *    counterparty; a funnel that counted one would call bookkeeping a first
 *    trade.
 * 3. The credential path is the segmentation that matters. A key minted on a
 *    person's own account is funded from the first call; a standalone
 *    registration starts at zero and cannot trade until somebody pays it.
 *    One rate across both hides exactly the wall this exists to measure.
 *
 * The median is deliberately reported beside the rate and never alone: a
 * median over those who succeeded is a survivor statistic, and on its own it
 * looks best precisely when most people fail.
 */
import { inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, authUser, trades } from '../db/schema';

/** Which door the identity came through. */
export type CredentialPath = 'browser_account' | 'owned_bot' | 'standalone_registration';

export interface FunnelSegment {
  segment: string;
  /** In the cohort: registered early enough to have had the whole window. */
  registered: number;
  /** Placed a real trade within `windowDays` of registering. */
  converted: number;
  /** null when nobody is in the cohort, never a misleading zero. */
  conversionRate: number | null;
  /** Median over the converted only. Read it with the rate, never alone. */
  medianMinutesToFirstTrade: number | null;
  /** Registered too recently to have had the window. Not failures. */
  censored: number;
}

export interface ParticipantFunnel {
  generatedAt: string;
  windowDays: number;
  overall: FunnelSegment;
  byCredentialPath: FunnelSegment[];
  bySource: FunnelSegment[];
  /** The house's own participants, left out because they are not customers. */
  excludedInternal: number;
}

export interface FunnelOptions {
  /** How long a participant gets to place a first trade. Default 7 days. */
  windowDays?: number;
  /** Injectable so the tests do not depend on the wall clock. */
  now?: Date;
}

interface Row {
  id: string;
  registeredAt: Date;
  path: CredentialPath;
  source: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarise(
  segment: string,
  cohort: Row[],
  censored: number,
  firstTrade: Map<string, Date>,
  windowMs: number,
): FunnelSegment {
  const minutes: number[] = [];
  for (const r of cohort) {
    const t = firstTrade.get(r.id);
    if (!t) continue;
    const delta = t.getTime() - r.registeredAt.getTime();
    if (delta < 0 || delta > windowMs) continue;
    minutes.push(Math.round(delta / 60_000));
  }
  return {
    segment,
    registered: cohort.length,
    converted: minutes.length,
    conversionRate: cohort.length === 0 ? null : minutes.length / cohort.length,
    medianMinutesToFirstTrade: median(minutes),
    censored,
  };
}

function group(
  rows: Row[],
  censoredRows: Row[],
  key: (r: Row) => string,
  firstTrade: Map<string, Date>,
  windowMs: number,
): FunnelSegment[] {
  const keys = new Set([...rows.map(key), ...censoredRows.map(key)]);
  return [...keys].sort().map(k =>
    summarise(
      k,
      rows.filter(r => key(r) === k),
      censoredRows.filter(r => key(r) === k).length,
      firstTrade,
      windowMs,
    ),
  );
}

export async function participantFunnel(opts: FunnelOptions = {}): Promise<ParticipantFunnel> {
  const windowDays = opts.windowDays ?? 7;
  const now = opts.now ?? new Date();
  const windowMs = windowDays * 86400_000;
  const cutoff = new Date(now.getTime() - windowMs);

  const all = await db
    .select({
      id: agents.id,
      createdAt: agents.createdAt,
      authUserId: agents.authUserId,
      ownerUserId: agents.ownerUserId,
      ownerAgentId: agents.ownerAgentId,
      source: agents.source,
      platformAdmin: agents.platformAdmin,
    })
    .from(agents);

  /**
   * Where attribution actually lives for a person.
   *
   * A `?ref=` slug on a landing URL is kept in a cookie and written to
   * `authUser.source` when the account is created, so a human's own agent row
   * carries nothing. Reading only `agents.source` reported every browser
   * participant as unattributed, which is what this did in production on
   * 2026-09-01. `lib/attribution.ts` has always resolved it as
   * `agents.source = X OR agents.authUserId IN (users with source X)`, and
   * this is the same rule: the agent's own tag first, the account's behind it.
   */
  const userSource = new Map<string, string>();
  for (const u of await db.select({ id: authUser.id, source: authUser.source }).from(authUser)) {
    if (u.source) userSource.set(u.id, u.source);
  }

  // The house: platform admins themselves, and anything they own. A bot the
  // operator runs is not a customer who did or did not convert.
  const adminAgentIds = new Set(all.filter(a => a.platformAdmin === true).map(a => a.id));
  const adminUserIds = new Set(
    all.filter(a => a.platformAdmin === true && a.authUserId !== null).map(a => a.authUserId as string),
  );
  const isInternal = (a: (typeof all)[number]) =>
    a.platformAdmin === true ||
    (a.ownerUserId !== null && adminUserIds.has(a.ownerUserId)) ||
    (a.ownerAgentId !== null && adminAgentIds.has(a.ownerAgentId));

  const external = all.filter(a => !isInternal(a));
  const excludedInternal = all.length - external.length;

  const rows: Row[] = external.map(a => ({
    id: a.id,
    registeredAt: a.createdAt as Date,
    path:
      a.authUserId !== null
        ? 'browser_account'
        : a.ownerUserId !== null || a.ownerAgentId !== null
          ? 'owned_bot'
          : 'standalone_registration',
    source: a.source ?? (a.authUserId ? (userSource.get(a.authUserId) ?? 'unattributed') : 'unattributed'),
  }));

  // Rule 1: only those who have had the whole window are in the cohort.
  const cohort = rows.filter(r => r.registeredAt.getTime() <= cutoff.getTime());
  const censoredRows = rows.filter(r => r.registeredAt.getTime() > cutoff.getTime());

  // Rule 2: a redemption is not a trade.
  const firstTrade = new Map<string, Date>();
  if (cohort.length > 0) {
    const tradeRows = await db
      .select({ agentId: trades.agentId, createdAt: trades.createdAt, kind: trades.kind })
      .from(trades)
      .where(
        inArray(
          trades.agentId,
          cohort.map(r => r.id),
        ),
      );
    for (const t of tradeRows) {
      if (t.kind !== 'trade') continue;
      const at = t.createdAt as Date;
      const seen = firstTrade.get(t.agentId);
      if (!seen || at.getTime() < seen.getTime()) firstTrade.set(t.agentId, at);
    }
  }

  return {
    generatedAt: now.toISOString(),
    windowDays,
    overall: summarise('all', cohort, censoredRows.length, firstTrade, windowMs),
    byCredentialPath: group(cohort, censoredRows, r => r.path, firstTrade, windowMs),
    bySource: group(cohort, censoredRows, r => r.source, firstTrade, windowMs),
    excludedInternal,
  };
}
