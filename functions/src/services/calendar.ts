import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { markets, outreachProspects, proposals } from '../db/schema';
import { resolutionInstant } from '../lib/date-utils';

/**
 * What is scheduled: the dates the platform already holds, between now and
 * the settle dates on the board.
 *
 * Spec: docs/data-room.md, "What is scheduled". The change log is
 * retrospective and the metric is forward, so a forecaster pricing the end of
 * the month was pricing the owner's calendar without being shown it. Nothing
 * here is a promise typed in for the page: every row is a date something
 * already in the database falls due on.
 *
 * The outreach list is stages only, one entry per person. Who is being
 * written to stays unpublished, exactly as the traffic section's referers do;
 * how many are at each stage is the chain that ends in "outside owners
 * deciding", and it names nobody.
 */

export interface Calendar {
  dates: Array<{ at: string; kind: 'settles' | 'decides'; label: string }>;
  outreach: { stages: string[] };
}

export async function buildCalendar(now = new Date()): Promise<Calendar> {
  const workspaceId = process.env.SELF_SYNC_WORKSPACE_ID;

  const dates: Calendar['dates'] = [];
  if (workspaceId) {
    const [books, ballot] = await Promise.all([
      db
        .select({ metricName: markets.metricName, targetDate: markets.targetDate })
        .from(markets)
        .where(
          and(
            eq(markets.workspaceId, workspaceId),
            eq(markets.resolved, false),
            eq(markets.voided, false),
            eq(markets.active, true),
          ),
        ),
      db
        .select({ title: proposals.title, decideBy: proposals.decideBy })
        .from(proposals)
        .where(
          and(eq(proposals.workspaceId, workspaceId), eq(proposals.status, 'pending'), isNotNull(proposals.decideBy)),
        ),
    ]);

    for (const b of books) {
      const at = resolutionInstant(b.targetDate);
      if (!at) continue;
      dates.push({ at, kind: 'settles', label: `${b.metricName} ${b.targetDate}` });
    }
    for (const p of ballot) {
      dates.push({ at: (p.decideBy as Date).toISOString(), kind: 'decides', label: p.title });
    }
  }

  const prospects = await db
    .select({ status: outreachProspects.status })
    .from(outreachProspects)
    .orderBy(asc(outreachProspects.position));

  return {
    // Soonest first, and only what is still ahead: a date that has passed is
    // in the change log, not in the plan.
    dates: dates.filter(d => new Date(d.at) > now).sort((a, b) => a.at.localeCompare(b.at)),
    outreach: { stages: prospects.map(p => p.status) },
  };
}
