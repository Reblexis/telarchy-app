/**
 * THE RULE: a season starts because a person started it, and only one runs at
 * a time.
 *
 * `startDueSeasons` started EVERY draft whose startsAt had passed, and the two
 * places that pick "the" running season use an unordered limit(1) / find, so
 * two running seasons meant /season and /leaderboard could price different
 * ones and a visitor pressing Enter could be told a season that began ten
 * minutes ago "has closed to new entries" (bug hunt 2026-08-31, P1-12). The
 * comment at routes/seasons.ts asserts the property the code did not enforce:
 * "the first season is deliberately singular".
 *
 * Owner decision 2026-09-01: "dont autostart season 1 we will start that
 * manually as needed." That reverses the 2026-08-20 direction ("make it
 * automatic"), so the endpoint stays and answers honestly rather than being
 * deleted: a scheduler still calling it gets a no-op with a reason, not a
 * silent start.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, prizeSeasons } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function publicFloor() {
  await db.insert(agents).values({ id: 'agent-season-owner', apiKeyHash: 'h-so', balance: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: 'ws-season',
    name: 'Season floor',
    createdBy: 'agent-season-owner',
    ownerAgentId: 'agent-season-owner',
    visibility: 'public',
  });
}

async function draft(id: string, startsAt: string, endsAt: string) {
  await db.insert(prizeSeasons).values({
    id,
    name: id,
    status: 'draft',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    poolUsd: 1000,
    workspaceIds: [],
    ladder: [],
    rulesUrl: 'https://telarchy.com/season-rules',
  });
}

const statusOf = async (id: string) => {
  const [s] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, id));
  return s.status;
};

describe('a due draft does not start itself', () => {
  test('startDueSeasons starts nothing, and says so', async () => {
    await publicFloor();
    await draft('season-1', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');

    const { startDueSeasons } = await import('../services/seasons');
    const result = await startDueSeasons();

    expect(result.started).toHaveLength(0);
    expect(await statusOf('season-1')).toBe('draft');
  });

  test('a person can still start it by hand', async () => {
    await publicFloor();
    await draft('season-1', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');

    const { startSeason } = await import('../services/seasons');
    await startSeason('season-1');

    expect(await statusOf('season-1')).toBe('running');
  });
});

describe('only one season runs at a time', () => {
  test('starting a second while one is running is refused', async () => {
    await publicFloor();
    await draft('season-0', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
    await draft('season-1', '2020-06-01T00:00:00Z', '2031-01-01T00:00:00Z');

    const { startSeason } = await import('../services/seasons');
    await startSeason('season-0');
    await expect(startSeason('season-1')).rejects.toThrow(/running/i);

    expect(await statusOf('season-1')).toBe('draft');
  });

  test('once the first has settled, the next can start', async () => {
    await publicFloor();
    await draft('season-0', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
    await draft('season-1', '2020-06-01T00:00:00Z', '2031-01-01T00:00:00Z');

    const { startSeason } = await import('../services/seasons');
    await startSeason('season-0');
    await db.update(prizeSeasons).set({ status: 'settled' }).where(eq(prizeSeasons.id, 'season-0'));

    await startSeason('season-1');
    expect(await statusOf('season-1')).toBe('running');
  });
});
