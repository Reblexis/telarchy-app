/**
 * Starting a season, in one place.
 *
 * Two callers: the platform-admin endpoint (`POST /api/seasons/:id/start`) and
 * the scheduler (`POST /api/cron/seasons`), which starts any draft whose
 * published start instant has passed. A season that starts itself is the point
 * (owner direction 2026-08-20): until now the start was a human remembering to
 * press a button at midnight, and a season that silently never starts takes
 * its baselines late and makes its own published window wrong.
 *
 * Both callers run THIS function rather than their own copy, because "start a
 * season" pins the workspace set and snapshots every baseline, and two
 * implementations of that would eventually disagree about what a season was
 * scored from.
 */

import { and, eq, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { prizeSeasons, seasonEntries, workspaces } from '../db/schema';
import { loadBoard } from '../lib/board';

export interface StartResult {
  seasonId: string;
  workspaceIds: string[];
  baselinesWritten: number;
  preRegistrationsKept: number;
}

/** Thrown for the conditions a caller should report rather than swallow. */
export class SeasonStartError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Pin the workspace set, snapshot a baseline for every participant, and move
 * the season to running. Idempotent by status: a season that is not a draft
 * throws rather than re-baselining, because a second baseline would silently
 * rewrite what every entrant is scored from.
 */
export async function startSeason(seasonId: string): Promise<StartResult> {
  const [season] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
  if (!season) throw new SeasonStartError('Season not found', 404);
  if (season.status !== 'draft') throw new SeasonStartError(`Season is ${season.status}, not draft`, 409);

  const publicWs = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.visibility, 'public'));
  const workspaceIds = publicWs.map(w => w.id);
  if (workspaceIds.length === 0) throw new SeasonStartError('No public workspaces to score over', 409);

  // Read the board directly, never the 30-second cache: this number is the
  // floor under every score in the season.
  const board = await loadBoard(workspaceIds);

  // Pre-registrations survive the start. Entry opens while a season is still a
  // draft, so by the time this runs there may already be rows here that ARE
  // entries. This used to `delete` the whole season's rows and rebuild them
  // from the board, which would have thrown every early entrant away without a
  // trace. So: keep optedIn and enteredAt as they stand, and write the
  // baseline over the top. The fairness rule is untouched, because it was
  // never about WHEN someone opted in; it is that the baseline is read for
  // everyone at this instant, which is exactly what board.profitById is.
  const existing = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, seasonId));
  const entryByAgent = new Map(existing.map(e => [e.agentId, e]));

  const agentIds = new Set<string>([
    ...board.agentIds.filter(id => (board.profitById.get(id) ?? 0) !== 0),
    ...existing.map(e => e.agentId),
  ]);

  const rows = [...agentIds].map(agentId => {
    const prior = entryByAgent.get(agentId);
    return {
      seasonId,
      agentId,
      optedIn: prior?.optedIn ?? false,
      enteredAt: prior?.enteredAt ?? null,
      rulesAcceptedAt: prior?.rulesAcceptedAt ?? null,
      confirmedOver18At: prior?.confirmedOver18At ?? null,
      contactEmail: prior?.contactEmail ?? null,
      baselineProfit: board.profitById.get(agentId) ?? 0,
    };
  });

  await db.transaction(async tx => {
    await tx.delete(seasonEntries).where(eq(seasonEntries.seasonId, seasonId));
    if (rows.length > 0) await tx.insert(seasonEntries).values(rows);
    await tx.update(prizeSeasons).set({ status: 'running', workspaceIds }).where(eq(prizeSeasons.id, seasonId));
  });

  return {
    seasonId,
    workspaceIds,
    baselinesWritten: board.agentIds.length,
    preRegistrationsKept: rows.filter(r => r.optedIn).length,
  };
}

/**
 * Start every draft season whose published start instant has passed.
 *
 * Called on a schedule. Starting late is possible (the scheduler runs every
 * few minutes, not continuously) and is accepted: the published startsAt stays
 * as announced and the baselines are read when this fires, which on an
 * eight-week season is a rounding error. Starting EARLY is not possible, which
 * is the half that matters, because an early baseline would score people on
 * trading they did before the season.
 *
 * One season failing does not stop the others: each is reported on its own.
 */
export async function startDueSeasons(now: Date = new Date()): Promise<{
  started: StartResult[];
  failed: Array<{ seasonId: string; error: string }>;
}> {
  const due = await db
    .select({ id: prizeSeasons.id })
    .from(prizeSeasons)
    .where(and(eq(prizeSeasons.status, 'draft'), lte(prizeSeasons.startsAt, now)));

  const started: StartResult[] = [];
  const failed: Array<{ seasonId: string; error: string }> = [];
  for (const row of due) {
    try {
      started.push(await startSeason(row.id));
    } catch (e) {
      // A season with no public workspaces to score over is the realistic
      // case, and it must not stop a sibling season from starting.
      console.error(`startDueSeasons: ${row.id} failed:`, e);
      failed.push({ seasonId: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { started, failed };
}
