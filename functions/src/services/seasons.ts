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

  // One at a time. routes/seasons.ts and routes/leaderboard.ts each pick "the"
  // running season with an unordered limit(1) / find, so two of them meant the
  // season page and the all-time board could price different ones, and a
  // visitor pressing Enter could be told a season that began ten minutes ago
  // "has closed to new entries". The comment at routes/seasons.ts asserts the
  // property this now enforces: the first season is deliberately singular
  // (bug hunt 2026-08-31, P1-12).
  const [alreadyRunning] = await db
    .select({ id: prizeSeasons.id, name: prizeSeasons.name })
    .from(prizeSeasons)
    .where(eq(prizeSeasons.status, 'running'))
    .limit(1);
  if (alreadyRunning) {
    throw new SeasonStartError(
      `"${alreadyRunning.name}" is still running; settle it before starting another season`,
      409,
    );
  }

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
  awaitingManualStart?: string[];
}> {
  // A SEASON STARTS BECAUSE A PERSON STARTED IT (owner decision 2026-09-01:
  // "dont autostart season 1 we will start that manually as needed"),
  // reversing the 2026-08-20 direction to make it automatic. Pinning
  // baselines and freezing a workspace set is the moment a season becomes
  // real money, and it is worth a human being present for it.
  //
  // The endpoint and this function stay, and answer honestly: a scheduler
  // still calling POST /api/cron/seasons gets a no-op naming the drafts it
  // did not start, rather than a silent nothing that reads like "no seasons
  // were due". Starting one is POST /api/seasons/:id/start.
  const due = await db
    .select({ id: prizeSeasons.id, name: prizeSeasons.name })
    .from(prizeSeasons)
    .where(and(eq(prizeSeasons.status, 'draft'), lte(prizeSeasons.startsAt, now)));
  if (due.length > 0) {
    console.log(
      `[seasons] ${due.length} draft(s) past their start instant and waiting for a person: ` +
        due.map(d => `${d.name} (${d.id})`).join(', '),
    );
  }
  return { started: [], failed: [], awaitingManualStart: due.map(d => d.id) };
}
