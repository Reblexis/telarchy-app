/**
 * What is scheduled (docs/data-room.md, "What is scheduled"): the dates
 * already committed between now and the settle dates on the board.
 *
 * The shipping log is retrospective and the metric is forward, so a
 * forecaster pricing the end of the month was pricing the owner's calendar
 * with no sight of it. Every row here is a date the platform already holds:
 * a book that settles, a proposal that must be decided, a person on the
 * outreach list at whatever stage they have reached.
 *
 * Names are never published. A prospect is a stage.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { markets, metrics, outreachProspects, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { buildCalendar } from '../services/calendar';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-telarchy';
const OTHER = 'ws-other';
const NOW = new Date('2026-09-09T12:00:00.000Z');

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  process.env.SELF_SYNC_WORKSPACE_ID = WS;
  await db.insert(workspaces).values([
    { id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' },
    { id: OTHER, name: 'Other', slug: 'other', createdBy: 'seed', visibility: 'public' },
  ]);
  await db.insert(metrics).values([
    { id: 'm1', workspaceId: WS, name: 'Active traders', value: 9, formula: '0' },
    { id: 'm2', workspaceId: OTHER, name: 'Theirs', value: 0, formula: '0' },
  ]);
});

async function market(
  id: string,
  targetDate: string,
  opts: { resolved?: boolean; workspaceId?: string; metricId?: string } = {},
) {
  await db.insert(markets).values({
    id,
    workspaceId: opts.workspaceId ?? WS,
    metricId: opts.metricId ?? 'm1',
    metricName: 'Active traders',
    targetDate,
    rangeMin: 0,
    rangeMax: 50,
    shares: [0, 0] as [number, number],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: opts.resolved ?? false,
    voided: false,
  });
}

async function proposal(id: string, opts: { status: string; decideBy?: string; workspaceId?: string; title?: string }) {
  await db.insert(proposals).values({
    id,
    workspaceId: opts.workspaceId ?? WS,
    proposedBy: 'seed',
    title: opts.title ?? 'A proposal',
    status: opts.status,
    conditionalMarketIds: [],
    decideBy: opts.decideBy ? new Date(opts.decideBy) : null,
  });
}

describe('the dates already committed', () => {
  test('an open book settling ahead is a row', async () => {
    await market('mkt', '2026-09-30');
    const c = await buildCalendar(NOW);
    expect(c.dates).toEqual([
      expect.objectContaining({ kind: 'settles', label: expect.stringContaining('Active traders') }),
    ]);
    expect(c.dates[0].at.slice(0, 10)).toBe('2026-10-01');
  });

  test('a book that already settled is history, not a plan', async () => {
    await market('mkt', '2026-08-31', { resolved: true });
    expect((await buildCalendar(NOW)).dates).toEqual([]);
  });

  test('a book whose date has passed is not published as upcoming', async () => {
    await market('mkt', '2026-08-31');
    expect((await buildCalendar(NOW)).dates).toEqual([]);
  });

  test('a pending proposal’s deadline is a row, carrying its title', async () => {
    await proposal('p1', { status: 'pending', decideBy: '2026-09-15T17:00:00Z', title: 'A $500 prize' });
    const c = await buildCalendar(NOW);
    expect(c.dates).toEqual([
      expect.objectContaining({ kind: 'decides', label: 'A $500 prize', at: '2026-09-15T17:00:00.000Z' }),
    ]);
  });

  test('a decided proposal has no deadline left to keep', async () => {
    await proposal('p1', { status: 'approved', decideBy: '2026-09-15T17:00:00Z' });
    expect((await buildCalendar(NOW)).dates).toEqual([]);
  });

  test('soonest first', async () => {
    await proposal('p1', { status: 'pending', decideBy: '2026-09-20T00:00:00Z', title: 'Later' });
    await proposal('p2', { status: 'pending', decideBy: '2026-09-12T00:00:00Z', title: 'Sooner' });
    const c = await buildCalendar(NOW);
    expect(c.dates.map(d => d.label)).toEqual(['Sooner', 'Later']);
  });

  test('a proposal’s branch markets are not extra dates on the calendar', async () => {
    // Two branch markets per proposal per horizon, on the same metric and the
    // same day as the baseline book. Published raw they printed the same date
    // over a hundred times on the live page (2026-09-09).
    await market('base', '2026-09');
    await db.insert(markets).values([
      {
        id: 'br-a',
        workspaceId: WS,
        metricId: 'm1',
        metricName: 'Active traders',
        targetDate: '2026-09',
        rangeMin: 0,
        rangeMax: 50,
        shares: [0, 0] as [number, number],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: 'p1',
        branch: 'approved',
      },
      {
        id: 'br-d',
        workspaceId: WS,
        metricId: 'm1',
        metricName: 'Active traders',
        targetDate: '2026-09',
        rangeMin: 0,
        rangeMax: 50,
        shares: [0, 0] as [number, number],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: 'p1',
        branch: 'declined',
      },
    ]);
    const c = await buildCalendar(NOW);
    expect(c.dates.filter(d => d.kind === 'settles')).toHaveLength(1);
  });

  test('two books on the same metric and the same day are one date', async () => {
    await market('a', '2026-09');
    await market('b', '2026-09');
    const c = await buildCalendar(NOW);
    expect(c.dates.filter(d => d.kind === 'settles')).toHaveLength(1);
  });

  test('another floor’s dates are not this platform’s plan', async () => {
    await market('mkt', '2026-09-30', { workspaceId: OTHER, metricId: 'm2' });
    await proposal('p1', { status: 'pending', decideBy: '2026-09-15T17:00:00Z', workspaceId: OTHER });
    expect((await buildCalendar(NOW)).dates).toEqual([]);
  });

  test('an instance that measures somebody else publishes no plan of ours', async () => {
    process.env.SELF_SYNC_WORKSPACE_ID = '';
    await market('mkt', '2026-09-30');
    expect((await buildCalendar(NOW)).dates).toEqual([]);
  });
});

describe('the outreach list', () => {
  test('one entry per person, carrying the stage they have reached and nothing else', async () => {
    await db.insert(outreachProspects).values([
      { id: 'o1', name: 'Ada Lovelace', company: 'Analytical', channel: 'email', status: 'sent' },
      { id: 'o2', name: 'Grace Hopper', company: 'Navy', channel: 'x', status: 'replied' },
      { id: 'o3', name: 'Someone', channel: 'other', status: 'draft' },
    ]);
    const c = await buildCalendar(NOW);
    expect(c.outreach.stages.sort()).toEqual(['draft', 'replied', 'sent']);
    const json = JSON.stringify(c);
    for (const secret of ['Ada', 'Lovelace', 'Grace', 'Navy', 'email']) expect(json).not.toContain(secret);
  });

  test('nobody on the list is an empty list, not a missing one', async () => {
    expect((await buildCalendar(NOW)).outreach.stages).toEqual([]);
  });
});
