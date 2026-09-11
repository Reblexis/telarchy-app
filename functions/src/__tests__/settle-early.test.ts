/**
 * THE RULE (docs/market-integrity.md, "The answer can arrive before the
 * period ends"): settling a metric files the reading and settles every open
 * book on that metric at that value, floor books and continued proposal
 * branches alike, and nothing else.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, events, markets, metricLogs, metrics, positions, proposals, updates } from '../db/schema';
import { initialPool } from '../lib/amm';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits } from '../lib/validation';
import { settleMetricEarly } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-settle-early';
const OWNER = 'agent-early-owner';
const HOLDER = 'agent-early-holder';
const B = 200;
const M = 'metric-early';
const OTHER = 'metric-other';

/** A future minute cell, so every book is well before its period. */
const cell = (minutesAhead: number) => new Date(Date.now() + minutesAhead * 60_000).toISOString().slice(0, 16);

async function book(id: string, opts: Partial<typeof markets.$inferInsert> = {}) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: M,
    metricName: 'Reached length',
    targetDate: cell(60),
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 100],
    liquidity: B,
    pool: initialPool(B) + 100,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    ...opts,
  });
}

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-early-owner', balance: 0 },
    { id: HOLDER, apiKeyHash: 'h-early-holder', balance: 0 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, { wsId: WS, name: 'Early', createdBy: OWNER, ownerAgentId: OWNER, visibility: 'public' });
  await db.insert(metrics).values([
    { id: M, workspaceId: WS, name: 'Reached length', value: 7, formula: '0', marketRangeMax: 100 },
    { id: OTHER, workspaceId: WS, name: 'Other', value: 1, formula: '0', marketRangeMax: 100 },
  ]);
  await db.insert(proposals).values({
    id: 'prop-1', workspaceId: WS, title: 'Turn left', description: '', status: 'approved', proposedBy: OWNER,
  } as never);
  await book('floor-1');
  await book('floor-2', { targetDate: cell(30) });
  await book('branch-approved', { proposalId: 'prop-1', branch: 'approved' });
  await book('branch-declined-voided', { proposalId: 'prop-1', branch: 'declined', voided: true, resolved: true, active: false, pool: 0 });
  await book('already-settled', { resolved: true, active: false, pool: 0, actualValue: 3 });
  await book('other-metric', { metricId: OTHER, metricName: 'Other' });
  await db.insert(positions).values({
    id: 'pos-1', workspaceId: WS, marketId: 'branch-approved', agentId: HOLDER, direction: 'higher', shares: 100, totalCost: 60,
  });
}

const row = async (id: string) => (await db.select().from(markets).where(and(eq(markets.id, id), eq(markets.workspaceId, WS))))[0];

describe('settling a metric early', () => {
  test('THE RULE: every open book on the metric settles at the value, floor books and the continued branch alike, and nothing else', async () => {
    await seed();
    const r = await settleMetricEarly(M, WS, { value: 9, reason: 'attempt 41 ended' });
    expect(r.settled.sort()).toEqual(['branch-approved', 'floor-1', 'floor-2']);
    for (const id of r.settled) {
      const m = await row(id);
      expect(m.resolved).toBe(true);
      expect(m.actualValue).toBe(9);
      expect(m.active).toBe(false);
    }
    expect((await row('other-metric')).resolved).toBe(false);
    expect((await row('already-settled')).actualValue).toBe(3);
    expect((await row('branch-declined-voided')).voided).toBe(true);
  });

  test('the settlement is early: resolvedAt is before the period end and settledReadingAt is asOf', async () => {
    await seed();
    const asOf = new Date(Date.now() - 5_000);
    await settleMetricEarly(M, WS, { value: 9, reason: 'ended', asOf });
    const m = await row('floor-1');
    expect(m.resolvedAt!.getTime()).toBeLessThan(new Date(`${m.targetDate}:00Z`).getTime());
    expect(m.settledReadingAt!.getTime()).toBe(asOf.getTime());
  });

  test('files the reading: a metric log at asOf with the value and the reason, and the metric value follows', async () => {
    await seed();
    const asOf = new Date(Date.now() - 5_000);
    await settleMetricEarly(M, WS, { value: 9, reason: 'attempt 41 ended', asOf });
    const logs = await db.select().from(metricLogs).where(and(eq(metricLogs.metricId, M), eq(metricLogs.workspaceId, WS)));
    expect(logs).toHaveLength(1);
    expect(logs[0].value).toBe(9);
    expect(logs[0].timestamp.getTime()).toBe(asOf.getTime());
    const [metric] = await db.select().from(metrics).where(eq(metrics.id, M));
    expect(metric.value).toBe(9);
    const notes = await db.select().from(updates).where(eq(updates.workspaceId, WS));
    expect(notes.map(n => n.description)).toEqual(['Settled early: attempt 41 ended']);
  });

  test('every settled book announces why: the market:resolved event carries settledEarly and the reason', async () => {
    await seed();
    const r = await settleMetricEarly(M, WS, { value: 9, reason: 'attempt 41 ended' });
    await new Promise(res => setTimeout(res, 50));
    const rows = await db.select().from(events).where(and(eq(events.workspaceId, WS), eq(events.type, 'market:resolved')));
    const byMarket = new Map(rows.map(e => [(e.data as { marketId: string }).marketId, e.data as Record<string, unknown>]));
    for (const id of r.settled) {
      expect(byMarket.get(id)).toMatchObject({ settledEarly: true, reason: 'attempt 41 ended', actualValue: 9 });
    }
  });

  test('holders are paid as on any settlement: 100 higher shares at the top of the range pay 100', async () => {
    await seed();
    await settleMetricEarly(M, WS, { value: 100, reason: 'ended' });
    const [h] = await db.select().from(agents).where(eq(agents.id, HOLDER));
    expect(fromUnits(h.balance)).toBeCloseTo(100, 2);
  });

  test('the value is clamped to the book range, and a negative value is refused before anything is written', async () => {
    await seed();
    await expect(settleMetricEarly(M, WS, { value: -1, reason: 'x' })).rejects.toThrow(/value/);
    expect((await row('floor-1')).resolved).toBe(false);
    await settleMetricEarly(M, WS, { value: 250, reason: 'x' });
    expect((await row('floor-1')).actualValue).toBe(100);
  });

  test('a reason is required', async () => {
    await seed();
    await expect(settleMetricEarly(M, WS, { value: 9, reason: '' })).rejects.toThrow(/reason/);
    expect((await row('floor-1')).resolved).toBe(false);
  });

  test('a second call settles nothing more: the books are already settled and no second log is filed', async () => {
    await seed();
    await settleMetricEarly(M, WS, { value: 9, reason: 'ended' });
    const again = await settleMetricEarly(M, WS, { value: 4, reason: 'again' });
    expect(again.settled).toEqual([]);
    expect((await row('floor-1')).actualValue).toBe(9);
  });

  test('a metric of another workspace, or an unknown one, settles nothing', async () => {
    await seed();
    await expect(settleMetricEarly(M, 'ws-someone-else', { value: 9, reason: 'x' })).rejects.toThrow(/not found/i);
    expect((await row('floor-1')).resolved).toBe(false);
  });

  test('a book opened after the call is a new question: it stays open', async () => {
    await seed();
    await settleMetricEarly(M, WS, { value: 9, reason: 'ended' });
    await book('floor-3', { targetDate: cell(61) });
    expect((await row('floor-3')).resolved).toBe(false);
  });
});
