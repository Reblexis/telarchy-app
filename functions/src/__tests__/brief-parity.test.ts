/**
 * The brief says what the page says (docs/vision.md, "The workspace brief").
 *
 * Three facts landed on the floor for a human reader: whether an approved
 * proposal was actually delivered, what the owner themselves called a metric
 * at a date, and the dated things the owner did that moved the line. An agent
 * reading the brief is being asked to price the same floor, so it gets the
 * same three. A surface that is richer for the person who does not trade than
 * for the participant who does is the gap this closes.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import {
  agents,
  announcements,
  metricLogs,
  metrics,
  ownerCalls,
  permissionGroups,
  proposals,
  workspaces,
} from '../db/schema';
import { buildWorkspaceContext, renderContextMarkdown } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-brief-parity';
const OWNER = 'viktor';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h', balance: 0, nickname: 'viktor' }]);
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: OWNER, visibility: 'public' });
  await db
    .insert(permissionGroups)
    .values([
      { id: 'g-pub', workspaceId: WS, name: 'Public', type: 'public', capabilities: ['read'], sourcePermissions: {} },
    ]);
  await db
    .insert(metrics)
    .values([{ id: 'm1', workspaceId: WS, name: 'Active traders', value: 9, formula: '0', marketRangeMax: 50 }]);
});

async function proposal(id: string, opts: Record<string, unknown> = {}) {
  await db.insert(proposals).values({
    id,
    workspaceId: WS,
    proposedBy: OWNER,
    title: 'Reach out to 30 founders',
    description: 'Thirty of them.',
    status: 'approved',
    conditionalMarketIds: [],
    resolvedAt: new Date('2026-08-20T00:00:00Z'),
    ...opts,
  });
}

describe('whether the approved work happened', () => {
  test('an approved proposal in the brief carries its delivery state', async () => {
    await proposal('p1', {
      deliveryState: 'delivered',
      deliveryNote: '30 written to, 4 replied',
      deliveredAt: new Date('2026-09-02T00:00:00Z'),
    });
    const ctx = await buildWorkspaceContext(WS);
    const c = ctx?.contracts.find(x => x.id === 'p1');
    expect(c?.delivery).toEqual({ state: 'delivered', note: '30 written to, 4 replied', at: '2026-09-02' });
  });

  test('an approved proposal nobody has spoken for says not started, rather than nothing', async () => {
    await proposal('p1');
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.contracts[0].delivery).toEqual({ state: 'not_started', note: null, at: null });
  });

  test('a pending proposal has no delivery to report and carries none', async () => {
    await proposal('p1', { status: 'pending', resolvedAt: null });
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.contracts[0].delivery).toBeNull();
  });

  test('the markdown a model reads says it in words', async () => {
    await proposal('p1', { deliveryState: 'not_started' });
    const md = renderContextMarkdown((await buildWorkspaceContext(WS))!);
    expect(md).toMatch(/not started/i);
  });
});

describe('what the owner called it', () => {
  test('the owner’s own calls are in the brief, with who made them and how many stand behind', async () => {
    await db.insert(ownerCalls).values([
      {
        id: 'c1',
        workspaceId: WS,
        metricId: 'm1',
        targetDate: '2026-09-30',
        value: 15,
        createdBy: OWNER,
        createdAt: new Date('2026-09-05T00:00:00Z'),
      },
    ]);
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.ownerCalls).toEqual([
      expect.objectContaining({ metricId: 'm1', targetDate: '2026-09-30', value: 15, by: 'viktor', revisions: 0 }),
    ]);
  });

  test('a floor with no call carries an empty list, not a missing field', async () => {
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.ownerCalls).toEqual([]);
  });

  test('the markdown names it as the owner’s, never as the market’s', async () => {
    await db.insert(ownerCalls).values([
      {
        id: 'c1',
        workspaceId: WS,
        metricId: 'm1',
        targetDate: '2026-09-30',
        value: 15,
        createdBy: OWNER,
        createdAt: new Date('2026-09-05T00:00:00Z'),
      },
    ]);
    const md = renderContextMarkdown((await buildWorkspaceContext(WS))!);
    expect(md).toContain("viktor's own call");
    expect(md).toContain('15');
  });
});

describe('what moved the line', () => {
  test('the dated things the owner did are in the brief', async () => {
    await db.insert(metricLogs).values({
      id: 'l1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Active traders',
      value: 4,
      timestamp: new Date('2026-08-01T00:00:00Z'),
    });
    await db.insert(announcements).values({
      id: 'a1',
      workspaceId: WS,
      body: 'Season 0 opened today.',
      publishedBy: OWNER,
      publishedAt: new Date('2026-08-22T00:00:00Z'),
    });
    await proposal('p1');
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.events.map(e => e.kind).sort()).toEqual(['announcement', 'approved']);
    expect(ctx?.events.find(e => e.kind === 'announcement')?.label).toBe('Season 0 opened today.');
  });

  test('the markdown lists them under a heading a model can find', async () => {
    await db.insert(announcements).values({
      id: 'a1',
      workspaceId: WS,
      body: 'Season 0 opened today.',
      publishedBy: OWNER,
      publishedAt: new Date('2026-08-22T00:00:00Z'),
    });
    const md = renderContextMarkdown((await buildWorkspaceContext(WS))!);
    expect(md).toContain('What moved it');
    expect(md).toContain('Season 0 opened today.');
  });
});
