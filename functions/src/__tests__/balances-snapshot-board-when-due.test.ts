/**
 * THE DAILY SNAPSHOT LOADS THE BOARD ONLY WHEN A ROW NEEDS ITS PROFIT.
 *
 * `snapshotAgentBalances` runs inside every resolve tick (every ten minutes,
 * under the singleton lock) and only the first run of a UTC day has any row
 * to write a profit onto. It used to load the whole board first and check
 * for pending rows second, so all 144 runs a day paid for the aggregation
 * (telarchy umbrella, notes/snake-load-audit-2026-09-10.md, item 7).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../lib/board', () => {
  const actual = jest.requireActual('../lib/board');
  return { ...actual, loadBoard: jest.fn(actual.loadBoard) };
});

import { eq } from 'drizzle-orm';
import { agentBalanceSnapshots, agents, workspaces } from '../db/schema';
import { loadBoard } from '../lib/board';
import { toUnits } from '../lib/validation';
import { snapshotAgentBalances } from '../services/balances';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const AGENT = 'snapshot-bot';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  (loadBoard as jest.Mock).mockClear();
  await db.insert(workspaces).values({ id: 'ws-snap', name: 'Snap', createdBy: 'owner', visibility: 'public' });
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h', balance: toUnits(10) });
});

describe('THE DAILY SNAPSHOT LOADS THE BOARD ONLY WHEN A ROW NEEDS ITS PROFIT', () => {
  test('the first run of the day loads the board once and records the profit', async () => {
    await snapshotAgentBalances();
    expect(loadBoard).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(agentBalanceSnapshots).where(eq(agentBalanceSnapshots.agentId, AGENT));
    expect(row.profit).toBe(0);
  });

  test('a later run the same day does not load the board at all', async () => {
    await snapshotAgentBalances();
    (loadBoard as jest.Mock).mockClear();
    await snapshotAgentBalances();
    await snapshotAgentBalances();
    expect(loadBoard).not.toHaveBeenCalled();
  });

  test('a row that still lacks its profit (written by an older build) gets it on the next run', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await db.insert(agentBalanceSnapshots).values({ agentId: AGENT, day, balance: toUnits(10) });
    await snapshotAgentBalances();
    expect(loadBoard).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(agentBalanceSnapshots).where(eq(agentBalanceSnapshots.agentId, AGENT));
    expect(row.profit).toBe(0);
  });
});
