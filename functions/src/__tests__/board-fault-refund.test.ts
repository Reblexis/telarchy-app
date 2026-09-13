/**
 * A FAULT REFUND COUNTS AS MONEY BACK ON ITS MARKET; A GRANT NEVER COUNTS.
 *
 * docs/ui-conventions.md, "Top traders": trading profit is measured off the
 * trades, so credits the platform hands an account never enter it, with one
 * exception. A `fault_refund` ledger row (ref_type 'market') repays what a
 * platform fault cost a holder on that market, and the board counts it as
 * settled money back there, so the ranking shows the result the holder would
 * have had without the fault.
 *
 * The case it exists for: on 2026-09-13 an API outage left the snake's moves
 * undecided until it hit a wall, its books settled early, and Wobert ended
 * 82.09 down on them. The refund paid him back; without this rule the board
 * would still have shown the 82.09 loss the bug caused.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, creditLedger, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadBoard } from '../lib/board';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-fault';
const OTHER_WS = 'ws-elsewhere';
const KAI = 'kai';
const BO = 'bo';
const B = 10;
const RESOLVED_AT = new Date('2026-09-13T03:40:00Z');

function market(overrides: Partial<typeof markets.$inferInsert> & { id: string; workspaceId: string }) {
  return {
    metricId: 'metric',
    metricName: 'Reached length',
    targetDate: '2026-09-13T03:56',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: B,
    pool: initialPool(B),
    active: false,
    resolved: true,
    actualValue: 20,
    resolvedAt: RESOLVED_AT,
    voided: false,
    ...overrides,
  };
}

let ledgerSeq = 0;
function ledger(row: {
  agentId: string;
  workspaceId: string;
  credits: number;
  reason: string;
  refType: string | null;
  refId: string | null;
}) {
  ledgerSeq += 1;
  return db.insert(creditLedger).values({
    id: `ledger-${ledgerSeq}`,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    deltaUnits: toUnits(row.credits),
    balanceAfterUnits: toUnits(row.credits),
    reason: row.reason,
    refType: row.refType,
    refId: row.refId,
  } as typeof creditLedger.$inferInsert);
}

/** kai holds 10 higher on each market; resolved at 20 of [0, 100] each pays 2. */
async function holding(agentId: string, workspaceId: string, marketId: string, cost: number) {
  await db.insert(positions).values({
    id: `p-${agentId}-${marketId}`,
    agentId,
    workspaceId,
    marketId,
    direction: 'higher',
    shares: 10,
    totalCost: cost,
  });
  await db.insert(trades).values({
    id: `t-${agentId}-${marketId}`,
    agentId,
    workspaceId,
    marketId,
    direction: 'higher',
    shares: 10,
    cost,
    createdAt: new Date('2026-09-13T03:30:00Z'),
  });
}

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values([
    { id: WS, name: 'Snake', createdBy: 'owner', visibility: 'public' },
    { id: OTHER_WS, name: 'Elsewhere', createdBy: 'owner', visibility: 'public' },
  ]);
  await db.insert(agents).values([
    { id: KAI, apiKeyHash: 'h-kai', balance: 0 },
    { id: BO, apiKeyHash: 'h-bo', balance: 0 },
  ]);
  await db
    .insert(markets)
    .values([
      market({ id: 'm-lost', workspaceId: WS }),
      market({ id: 'm-won', workspaceId: WS, actualValue: 60 }),
      market({ id: 'm-away', workspaceId: OTHER_WS }),
    ]);
  // m-lost: paid 6, worth 2 -> -4. m-won: paid 5, worth 6 -> +1. Net -3 in WS.
  await holding(KAI, WS, 'm-lost', 6);
  await holding(KAI, WS, 'm-won', 5);
  // m-away: paid 7, worth 2 -> -5, in the other workspace.
  await holding(KAI, OTHER_WS, 'm-away', 7);
  // bo, untouched by any refund, is the control.
  await holding(BO, WS, 'm-won', 3);
});

describe('A FAULT REFUND COUNTS AS MONEY BACK ON ITS MARKET; A GRANT NEVER COUNTS', () => {
  test('without any refund the board shows the loss (the baseline the rule changes)', async () => {
    const board = await loadBoard([WS]);
    expect(board.profitById.get(KAI)).toBeCloseTo(-3, 6);
    expect(board.profitById.get(BO)).toBeCloseTo(3, 6);
  });

  test('the ranking showed -82 credits the bug took (2026-09-13): a fault refund of the net loss brings the total back to zero', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 3,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-lost',
    });
    const board = await loadBoard([WS]);
    expect(board.profitById.get(KAI)).toBeCloseTo(0, 6);
  });

  test('the refund is settled money: it lands in the settled half of the split, and the split still adds up', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 3,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-lost',
    });
    const b = (await loadBoard([WS])).breakdownById.get(KAI)!;
    expect(b.settled).toBeCloseTo(0, 6);
    expect(b.open).toBeCloseTo(0, 6);
    expect(b.total).toBeCloseTo(b.settled + b.open, 6);
  });

  test('an apology grant (admin_adjustment) never enters trading profit', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 1000,
      reason: 'admin_adjustment',
      refType: null,
      refId: 'apology',
    });
    await ledger({
      agentId: KAI,
      workspaceId: 'platform',
      credits: 500,
      reason: 'signup_grant',
      refType: null,
      refId: null,
    });
    const board = await loadBoard([WS]);
    expect(board.profitById.get(KAI)).toBeCloseTo(-3, 6);
  });

  test('a fault refund counts only on a board whose workspace set holds its market', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: OTHER_WS,
      credits: 5,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-away',
    });
    expect((await loadBoard([WS])).profitById.get(KAI)).toBeCloseTo(-3, 6);
    expect((await loadBoard([OTHER_WS])).profitById.get(KAI)).toBeCloseTo(0, 6);
    expect((await loadBoard([WS, OTHER_WS])).profitById.get(KAI)).toBeCloseTo(-3, 6);
  });

  test('a fault_refund row that names no market is not counted', async () => {
    await ledger({ agentId: KAI, workspaceId: WS, credits: 3, reason: 'fault_refund', refType: null, refId: 'm-lost' });
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 3,
      reason: 'fault_refund',
      refType: 'proposal',
      refId: 'm-lost',
    });
    expect((await loadBoard([WS])).profitById.get(KAI)).toBeCloseTo(-3, 6);
  });

  test('a market id that exists nowhere counts on no board', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 3,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-gone',
    });
    // -3 in WS and -5 in OTHER_WS, untouched.
    expect((await loadBoard([WS, OTHER_WS])).profitById.get(KAI)).toBeCloseTo(-8, 6);
  });

  test('a market id that exists in two workspaces of the set counts the refund once, on the workspace it was booked in', async () => {
    await db.insert(markets).values(market({ id: 'm-lost', workspaceId: OTHER_WS }));
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 3,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-lost',
    });
    expect((await loadBoard([WS, OTHER_WS])).profitById.get(KAI)).toBeCloseTo(-5, 6);
    expect((await loadBoard([OTHER_WS])).profitById.get(KAI)).toBeCloseTo(-5, 6);
  });

  test('several refunds to the same holder add up, and nobody else moves', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 1,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-lost',
    });
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 2,
      reason: 'fault_refund',
      refType: 'market',
      refId: 'm-lost',
    });
    const board = await loadBoard([WS]);
    expect(board.profitById.get(KAI)).toBeCloseTo(0, 6);
    expect(board.profitById.get(BO)).toBeCloseTo(3, 6);
  });
});
