/**
 * What moved it (docs/ui-conventions.md, "The price and the chart"): the
 * dated things the owner did, drawn against the line they moved.
 *
 * The floor drew a metric's history with nothing to explain it: a jump on a
 * particular day had a cause, the cause was already in the database with a
 * date on it, and the chart said nothing. These are those causes.
 *
 * What is pinned here is the SET. An event is something the owner did that a
 * forecaster could not otherwise see happen on a date: an announcement, a
 * decision, a delivery. Not a proposal being posted (anyone can post one, and
 * it moves nothing), and nothing at all from a workspace this floor is not.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { announcements, proposals, workspaces } from '../db/schema';
import { buildFloorEvents } from '../services/floor-events';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-events';
const OTHER = 'ws-other';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values([
    { id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' },
    { id: OTHER, name: 'Elsewhere', slug: 'elsewhere', createdBy: 'seed', visibility: 'public' },
  ]);
});

async function announce(id: string, body: string, at: string, workspaceId = WS) {
  await db.insert(announcements).values({ id, workspaceId, body, publishedBy: 'seed', publishedAt: new Date(at) });
}

async function proposal(
  id: string,
  opts: {
    title: string;
    status: string;
    resolvedAt?: string;
    deliveryState?: string;
    deliveredAt?: string;
    workspaceId?: string;
  },
) {
  await db.insert(proposals).values({
    id,
    workspaceId: opts.workspaceId ?? WS,
    proposedBy: 'seed',
    title: opts.title,
    status: opts.status,
    conditionalMarketIds: [],
    resolvedAt: opts.resolvedAt ? new Date(opts.resolvedAt) : null,
    deliveryState: opts.deliveryState ?? 'not_started',
    deliveredAt: opts.deliveredAt ? new Date(opts.deliveredAt) : null,
  });
}

describe('what counts as an event', () => {
  test('an announcement, by the line it is known by', async () => {
    await announce('a1', 'Season 0 opened today.\n\nThe rest of the body.', '2026-08-22T10:00:00Z');
    const events = await buildFloorEvents(WS);
    expect(events).toEqual([{ at: '2026-08-22T10:00:00.000Z', kind: 'announcement', label: 'Season 0 opened today.' }]);
  });

  test('a decision, on the day it was decided', async () => {
    await proposal('p1', { title: 'Trader rewards', status: 'approved', resolvedAt: '2026-08-28T09:00:00Z' });
    await proposal('p2', { title: 'Sponsor a prize', status: 'declined', resolvedAt: '2026-08-29T09:00:00Z' });
    const events = await buildFloorEvents(WS);
    expect(events.map(e => [e.kind, e.label])).toEqual([
      ['declined', 'Sponsor a prize'],
      ['approved', 'Trader rewards'],
    ]);
  });

  test('a delivery, on the day it was delivered rather than the day it was approved', async () => {
    await proposal('p1', {
      title: 'Reach out to 30 founders',
      status: 'approved',
      resolvedAt: '2026-08-20T09:00:00Z',
      deliveryState: 'delivered',
      deliveredAt: '2026-09-02T09:00:00Z',
    });
    const events = await buildFloorEvents(WS);
    expect(events.map(e => [e.at.slice(0, 10), e.kind])).toEqual([
      ['2026-09-02', 'delivered'],
      ['2026-08-20', 'approved'],
    ]);
  });

  test('a proposal still on the ballot is not an event: posting one moves nothing', async () => {
    await proposal('p1', { title: 'Still deciding', status: 'pending' });
    expect(await buildFloorEvents(WS)).toEqual([]);
  });

  test('another floor’s events are not this floor’s', async () => {
    await announce('a1', 'Their news.', '2026-08-22T10:00:00Z', OTHER);
    await proposal('p1', {
      title: 'Their job',
      status: 'approved',
      resolvedAt: '2026-08-28T09:00:00Z',
      workspaceId: OTHER,
    });
    expect(await buildFloorEvents(WS)).toEqual([]);
  });
});

describe('how many, and in what order', () => {
  test('newest first', async () => {
    await announce('a1', 'Older.', '2026-08-01T10:00:00Z');
    await announce('a2', 'Newer.', '2026-09-01T10:00:00Z');
    const events = await buildFloorEvents(WS);
    expect(events.map(e => e.label)).toEqual(['Newer.', 'Older.']);
  });

  test('capped, and the cap keeps the recent end', async () => {
    for (let i = 0; i < 20; i++) {
      await announce(`a${i}`, `Number ${i}.`, `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`);
    }
    const events = await buildFloorEvents(WS);
    expect(events.length).toBeLessThanOrEqual(12);
    expect(events[0].label).toBe('Number 19.');
  });

  test('an event older than the window the chart draws is left out', async () => {
    await announce('old', 'Ancient.', '2020-01-01T10:00:00Z');
    await announce('new', 'Recent.', '2026-09-01T10:00:00Z');
    const events = await buildFloorEvents(WS, new Date('2026-08-01T00:00:00Z'));
    expect(events.map(e => e.label)).toEqual(['Recent.']);
  });
});
