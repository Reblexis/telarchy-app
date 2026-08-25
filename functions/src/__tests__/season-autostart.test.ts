/**
 * A season starts itself.
 *
 * Until 2026-08-20 the start was a human calling POST /api/seasons/:id/start at
 * the right minute. That is the one step in a season's life that can silently
 * not happen: nothing errors, nothing alerts, the page keeps saying "starts
 * in", and the baselines get taken whenever somebody notices. The season this
 * was written for was three hours from its start with nobody scheduled to
 * press anything.
 *
 * The half that matters is the asymmetry: starting LATE is fine and expected
 * (the scheduler runs every few minutes, not continuously), starting EARLY is
 * not, because an early baseline scores people on trading they did before the
 * season began.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, prizeSeasons, seasonEntries, workspaces } from '../db/schema';
import { clearBoardCache } from '../routes/leaderboard';
import { SeasonStartError, startDueSeasons, startSeason } from '../services/seasons';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const LADDER = [{ place: 1, prizeUsd: 500 }];

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
});

async function seed() {
  await db.insert(agents).values([{ id: 'entrant', apiKeyHash: 'h-entrant', balance: 0, nickname: 'entrant' }]);
  await db.insert(workspaces).values({
    id: 'ws-auto',
    name: 'Auto',
    slug: 'auto',
    createdBy: 'entrant',
    visibility: 'public',
  });
}

async function makeSeason(id: string, startsAt: Date, status = 'draft') {
  await db.insert(prizeSeasons).values({
    id,
    name: id,
    startsAt,
    endsAt: new Date('2026-12-31'),
    poolUsd: 1000,
    ladder: LADDER,
    workspaceIds: [],
    rulesUrl: '/legal/season-0',
    status,
  });
}

const statusOf = async (id: string) => (await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, id)))[0]?.status;

describe('a due season starts on its own', () => {
  test('a draft whose start instant has passed is started', async () => {
    await seed();
    await makeSeason('past', new Date('2026-08-22T00:00:00Z'));

    const r = await startDueSeasons(new Date('2026-08-22T00:07:00Z'));
    expect(r.started.map(s => s.seasonId)).toEqual(['past']);
    expect(await statusOf('past')).toBe('running');
  });

  test('a draft whose start instant has NOT passed is left alone', async () => {
    // The asymmetry that matters: late is fine, early is never. An early
    // baseline scores people on trading they did before the season.
    await seed();
    await makeSeason('future', new Date('2026-08-22T00:00:00Z'));

    const r = await startDueSeasons(new Date('2026-08-21T23:59:00Z'));
    expect(r.started).toEqual([]);
    expect(await statusOf('future')).toBe('draft');
  });

  test('exactly at the start instant counts as due', async () => {
    await seed();
    await makeSeason('exact', new Date('2026-08-22T00:00:00Z'));
    const r = await startDueSeasons(new Date('2026-08-22T00:00:00Z'));
    expect(r.started.map(s => s.seasonId)).toEqual(['exact']);
  });

  test('running twice does not re-baseline', async () => {
    // A second baseline would silently rewrite what every entrant is scored
    // from, which is why status is the guard rather than a timestamp.
    await seed();
    await makeSeason('once', new Date('2026-08-22T00:00:00Z'));
    await startDueSeasons(new Date('2026-08-22T00:05:00Z'));
    const second = await startDueSeasons(new Date('2026-08-22T00:15:00Z'));
    expect(second.started).toEqual([]);
    expect(await statusOf('once')).toBe('running');
  });

  test('an already-running or settled season is never touched', async () => {
    await seed();
    await makeSeason('run', new Date('2026-08-01T00:00:00Z'), 'running');
    await makeSeason('done', new Date('2026-07-01T00:00:00Z'), 'settled');
    const r = await startDueSeasons(new Date('2026-08-22T00:00:00Z'));
    expect(r.started).toEqual([]);
    expect(await statusOf('run')).toBe('running');
    expect(await statusOf('done')).toBe('settled');
  });
});

describe('what the auto-start preserves', () => {
  test('a pre-registration keeps its entry, agreement and contact email', async () => {
    // Entry opens while a season is still a draft, so by the time this fires
    // there are real entries in the table. They must survive the baseline pass.
    await seed();
    await makeSeason('keep', new Date('2026-08-22T00:00:00Z'));
    const enteredAt = new Date('2026-08-20T10:00:00Z');
    await db.insert(seasonEntries).values({
      seasonId: 'keep',
      agentId: 'entrant',
      optedIn: true,
      enteredAt,
      rulesAcceptedAt: enteredAt,
      confirmedOver18At: enteredAt,
      contactEmail: 'entrant@example.com',
      baselineProfit: 0,
    });

    const r = await startDueSeasons(new Date('2026-08-22T00:03:00Z'));
    expect(r.started[0].preRegistrationsKept).toBe(1);

    const [row] = await db.select().from(seasonEntries).where(eq(seasonEntries.seasonId, 'keep'));
    expect(row.optedIn).toBe(true);
    expect(row.enteredAt).toEqual(enteredAt);
    expect(row.rulesAcceptedAt).toEqual(enteredAt);
    expect(row.confirmedOver18At).toEqual(enteredAt);
    expect(row.contactEmail).toBe('entrant@example.com');
  });
});

describe('one bad season does not stop the rest', () => {
  test('a season with nothing to score over is reported, not thrown', async () => {
    // The realistic failure: no public workspace exists yet. It must not stop
    // a sibling season from starting, and it must not vanish silently either.
    await makeSeason('nows', new Date('2026-08-22T00:00:00Z'));
    const r = await startDueSeasons(new Date('2026-08-22T00:05:00Z'));
    expect(r.started).toEqual([]);
    expect(r.failed.map(f => f.seasonId)).toEqual(['nows']);
    expect(r.failed[0].error).toMatch(/No public workspaces/);
    expect(await statusOf('nows')).toBe('draft');
  });
});

describe('the endpoint and the scheduler run the same code', () => {
  test('startSeason refuses a season that is not a draft', async () => {
    await seed();
    await makeSeason('r2', new Date('2026-08-01T00:00:00Z'), 'running');
    await expect(startSeason('r2')).rejects.toBeInstanceOf(SeasonStartError);
  });

  test('startSeason refuses a season that does not exist', async () => {
    await expect(startSeason('nope')).rejects.toThrow(/not found/i);
  });
});
