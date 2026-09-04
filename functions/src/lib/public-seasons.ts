/**
 * The public view of the prize seasons, shared by GET /api/seasons and the
 * home payload (GET /api/marketplace/home), so the two can never disagree on
 * what a season looks like to someone who is not signed in.
 */
import { db } from '../db/client';
import { prizeSeasons } from '../db/schema';
import type { LadderRung, SeasonPayoutMode, SeasonStatus } from './seasons';

export function publicSeason(s: typeof prizeSeasons.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    status: s.status as SeasonStatus,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    settledAt: s.settledAt,
    poolUsd: s.poolUsd,
    payoutMode: (s.payoutMode ?? 'ladder') as SeasonPayoutMode,
    minPayoutUsd: s.minPayoutUsd ?? 0,
    strictEligibility: s.strictEligibility ?? false,
    ladder: (s.ladder ?? []) as LadderRung[],
    rulesUrl: s.rulesUrl,
  };
}

export type PublicSeason = ReturnType<typeof publicSeason>;

/** Every season, newest first. Public: the pool and the ladder are the pitch. */
export async function listPublicSeasons(): Promise<PublicSeason[]> {
  const rows = await db.select().from(prizeSeasons);
  rows.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  return rows.map(publicSeason);
}
