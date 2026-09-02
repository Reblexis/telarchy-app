/**
 * Dual-branch conditional market lifecycle.
 *
 * Every proposal spawns two markets per (metric, targetDate): one for the
 * approved-counterfactual and one for the declined-counterfactual. The
 * decision voids only the unrealised branch, leaving the realised branch
 * live to resolve against actual KPI. Withdraw and spam-decline void both.
 *
 * These tests pin the lifecycle so we don't silently regress to single-branch
 * (which conflates causal effect with the natural-trajectory baseline).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics as metricsTable, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import {
  approveProposal,
  createConditionalMarkets,
  declineProposal,
  declineProposalAsSpam,
  getProposalMarketSummariesForProposal,
  withdrawProposal,
} from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-dual';
const OWNER = 'owner-dual';
const PROPOSER = 'proposer-dual';
const METRIC_A = 'metric-a';
const METRIC_B = 'metric-b';
const TARGET = '2026-12';

async function seedWorkspaceAndMetrics() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-dual', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-proposer-dual', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Dual',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(metricsTable).values([
    { id: METRIC_A, workspaceId: WS, name: 'Metric A', value: 0, formula: '0', marketRangeMax: 100 },
    { id: METRIC_B, workspaceId: WS, name: 'Metric B', value: 0, formula: '0', marketRangeMax: 200 },
  ]);
  // Two natural-trajectory (non-proposal) markets, one per metric. These are
  // the sources that conditional markets clone from.
  await db.insert(markets).values([
    {
      id: 'mkt-base-a',
      workspaceId: WS,
      metricId: METRIC_A,
      metricName: 'Metric A',
      targetDate: TARGET,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
    {
      id: 'mkt-base-b',
      workspaceId: WS,
      metricId: METRIC_B,
      metricName: 'Metric B',
      targetDate: TARGET,
      rangeMin: 0,
      rangeMax: 200,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
  ]);
}

async function insertProposal(id: string, status: string = 'pending') {
  await db.insert(proposals).values({
    id,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: `proposal ${id}`,
    description: '',
    status,
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
}

async function branchesFor(proposalId: string) {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));
  const grouped: Record<string, Array<{ id: string; branch: string | null; resolved: boolean; voided: boolean }>> = {};
  for (const m of rows) {
    const key = `${m.metricId}:${m.targetDate}`;
    (grouped[key] ||= []).push({ id: m.id, branch: m.branch, resolved: m.resolved, voided: m.voided });
  }
  return grouped;
}

describe('createConditionalMarkets — dual spawn', () => {
  test('spawns approved + declined for every source metric', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    const ids = await createConditionalMarkets('p1', WS, {});
    expect(ids).toHaveLength(4); // 2 metrics * 2 branches

    const grouped = await branchesFor('p1');
    expect(Object.keys(grouped).sort()).toEqual([`${METRIC_A}:${TARGET}`, `${METRIC_B}:${TARGET}`]);
    for (const pair of Object.values(grouped)) {
      const branches = pair.map(p => p.branch).sort();
      expect(branches).toEqual(['approved', 'declined']);
    }
  });

  test('re-calling is idempotent when full pair set already exists', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    const first = await createConditionalMarkets('p1', WS, {});
    const second = await createConditionalMarkets('p1', WS, {});
    expect(second.sort()).toEqual(first.sort());
  });

  test('legacy proposals with only approved branch get the missing declined branch added (without nuking trades)', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    // Simulate a pre-migration legacy proposal: insert only approved-branch
    // markets manually, as if 0033 had backfilled them.
    await db.insert(markets).values([
      {
        id: 'legacy-approved-a',
        workspaceId: WS,
        metricId: METRIC_A,
        metricName: 'Metric A',
        targetDate: TARGET,
        rangeMin: 0,
        rangeMax: 100,
        shares: [10, 5],
        liquidity: 5,
        pool: initialPool(5),
        active: true,
        resolved: false,
        voided: false,
        proposalId: 'p1',
        branch: 'approved',
      },
      {
        id: 'legacy-approved-b',
        workspaceId: WS,
        metricId: METRIC_B,
        metricName: 'Metric B',
        targetDate: TARGET,
        rangeMin: 0,
        rangeMax: 200,
        shares: [0, 0],
        liquidity: 5,
        pool: initialPool(5),
        active: true,
        resolved: false,
        voided: false,
        proposalId: 'p1',
        branch: 'approved',
      },
    ]);

    const ids = await createConditionalMarkets('p1', WS, {});
    // Existing approved-branch markets kept, two new declined-branch markets spawned.
    expect(ids).toHaveLength(4);
    expect(ids).toContain('legacy-approved-a');
    expect(ids).toContain('legacy-approved-b');

    // The legacy approved markets are untouched (still have their shares).
    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      const approved = pair.find(p => p.branch === 'approved')!;
      const declined = pair.find(p => p.branch === 'declined')!;
      expect(approved.voided).toBe(false);
      expect(declined.voided).toBe(false);
    }
    // Verify approved-a still has its non-zero shares (proxy for "trades preserved").
    const [aRow] = await db.select().from(markets).where(eq(markets.id, 'legacy-approved-a'));
    expect(aRow.shares as [number, number]).toEqual([10, 5]);
  });

  // NOTE: the CHECK constraint `proposalId NOT NULL <-> branch NOT NULL` is
  // enforced in production Postgres but PGlite (used by this harness) does
  // not always enforce CHECK during the type of write Drizzle issues here,
  // so we don't assert on it. The service layer never produces a row that
  // would violate it (createConditionalMarkets always sets branch when
  // proposalId is set), which the other tests in this file cover.
});

describe('approveProposal — voids only the declined branch', () => {
  test('declined-branch markets become voided, approved-branch stays live', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});

    await approveProposal('p1', WS, OWNER);

    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      const approved = pair.find(p => p.branch === 'approved')!;
      const declined = pair.find(p => p.branch === 'declined')!;
      expect(approved.voided).toBe(false);
      expect(approved.resolved).toBe(false);
      expect(declined.voided).toBe(true);
      expect(declined.resolved).toBe(true);
    }
  });
});

describe('declineProposal — voids approved, keeps declined live', () => {
  test('approved-branch markets become voided, declined-branch stays live for KPI resolution', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});

    await declineProposal('p1', WS, OWNER);

    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      const approved = pair.find(p => p.branch === 'approved')!;
      const declined = pair.find(p => p.branch === 'declined')!;
      expect(approved.voided).toBe(true);
      expect(approved.resolved).toBe(true);
      expect(declined.voided).toBe(false);
      expect(declined.resolved).toBe(false);
    }
  });
});

describe('declineProposalAsSpam and withdrawProposal — void both branches', () => {
  test('spam-decline voids both branches', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});

    await declineProposalAsSpam('p1', WS, OWNER);

    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      for (const m of pair) {
        expect(m.voided).toBe(true);
        expect(m.resolved).toBe(true);
      }
    }
  });

  test('withdraw voids both branches', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});

    await withdrawProposal('p1', WS, PROPOSER);

    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      for (const m of pair) {
        expect(m.voided).toBe(true);
        expect(m.resolved).toBe(true);
      }
    }
  });
});

describe('paired summary shape', () => {
  test('one entry per (metric, targetDate), both branches present, delta computed', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    // Subsidy gives both branches positive LMSR liquidity, so consensus()
    // resolves to the midpoint (50/50 prior) instead of returning undefined.
    await createConditionalMarkets('p1', WS, {
      contributions: { [PROPOSER]: 1 },
      strict: true,
    });

    const summary = await getProposalMarketSummariesForProposal('p1', WS);
    expect(summary).toHaveLength(2);
    for (const pair of summary) {
      expect(pair.approved).not.toBeNull();
      expect(pair.declined).not.toBeNull();
      // No trades yet, so both consensuses sit at the midpoint and delta is 0.
      expect(pair.delta).toBeCloseTo(0, 6);
      expect(pair.approved!.marketId).not.toBe(pair.declined!.marketId);
    }
  });

  test('after approve, summary still shows both branches (declined frozen at refund)', async () => {
    await seedWorkspaceAndMetrics();
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});
    await approveProposal('p1', WS, OWNER);

    const summary = await getProposalMarketSummariesForProposal('p1', WS);
    for (const pair of summary) {
      expect(pair.approved).not.toBeNull();
      expect(pair.declined).not.toBeNull();
      expect(pair.declined!.voided).toBe(true);
      expect(pair.approved!.voided).toBe(false);
    }
  });
});

describe('approveProposal — a reward the owner cannot pay is refused before anything changes', () => {
  // docs/guides/proposals.md, "Approving": the reward is checked first, so a
  // 409 leaves the proposal exactly as it was. Until 2026-09-02 the declined
  // branch was voided and refunded before the reward was attempted, and an
  // owner whose balance had gone negative (the wallet-first staking bug)
  // was left with a pending proposal whose declined branch was already gone.
  async function seedBrokeOwner() {
    await seedWorkspaceAndMetrics();
    await db.update(workspaces).set({ proposalReward: 20 }).where(eq(workspaces.id, WS));
    await db
      .update(agents)
      .set({ balance: toUnits(5) })
      .where(eq(agents.id, OWNER));
    await insertProposal('p1');
    await createConditionalMarkets('p1', WS, {});
  }

  async function balanceOf(agentId: string): Promise<number> {
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    return row.balance as number;
  }

  test('the declined branch stays open after the 409', async () => {
    await seedBrokeOwner();
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/insufficient/i);
    const grouped = await branchesFor('p1');
    expect(Object.keys(grouped)).toHaveLength(2);
    for (const pair of Object.values(grouped)) {
      expect(pair).toHaveLength(2);
      for (const m of pair) {
        expect(m.voided).toBe(false);
        expect(m.resolved).toBe(false);
      }
    }
    const [p] = await db.select().from(proposals).where(eq(proposals.id, 'p1'));
    expect(p.status).toBe('pending');
  });

  test('no credits move: neither the buyout nor the reward runs', async () => {
    await seedBrokeOwner();
    const ownerBefore = await balanceOf(OWNER);
    const proposerBefore = await balanceOf(PROPOSER);
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/insufficient/i);
    expect(await balanceOf(OWNER)).toBe(ownerBefore);
    expect(await balanceOf(PROPOSER)).toBe(proposerBefore);
  });

  test('the 409 names what is needed and what the owner has', async () => {
    await seedBrokeOwner();
    await expect(approveProposal('p1', WS, OWNER)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/need 20, have 5/),
    });
  });

  test('a negative owner balance is refused the same way', async () => {
    await seedBrokeOwner();
    await db
      .update(agents)
      .set({ balance: toUnits(-1716.229992) })
      .where(eq(agents.id, OWNER));
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/have -1716\.229992/);
    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) for (const m of pair) expect(m.voided).toBe(false);
  });

  test('once the owner can pay, the same approve goes through', async () => {
    await seedBrokeOwner();
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/insufficient/i);
    await db
      .update(agents)
      .set({ balance: toUnits(1000) })
      .where(eq(agents.id, OWNER));
    const r = await approveProposal('p1', WS, OWNER);
    expect(r.rewardPaid).toBe(20);
    const grouped = await branchesFor('p1');
    for (const pair of Object.values(grouped)) {
      expect(pair.find(m => m.branch === 'declined')!.voided).toBe(true);
      expect(pair.find(m => m.branch === 'approved')!.voided).toBe(false);
    }
  });
});
