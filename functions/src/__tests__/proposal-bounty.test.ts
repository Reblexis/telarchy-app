/**
 * Bounty model for proposals: approve pays reward (owner -> proposer), decline-spam
 * charges penalty (proposer -> owner), withdraw is free, pending cap returns 429.
 *
 * Drives the service layer directly to avoid Express/auth/middleware. Marketplace
 * stat aggregation is verified by inserting proposals at known statuses and
 * reading the aggregated counts the same way the route computes them.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { agents, proposals, workspaces } from '../db/schema';
import { fromUnits, toUnits } from '../lib/validation';
import {
  approveProposal,
  countPendingProposalsByProposer,
  declineProposal,
  declineProposalAsSpam,
  withdrawProposal,
} from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-bounty';
const OWNER = 'owner-agent';
const PROPOSER = 'proposer-agent';

async function seed(opts: {
  ownerBalance: number;
  proposerBalance: number;
  proposalReward?: number;
  spamPenalty?: number;
  maxPending?: number;
}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(opts.ownerBalance) },
    { id: PROPOSER, apiKeyHash: 'h-proposer', balance: toUnits(opts.proposerBalance) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Bounty Test',
    createdBy: OWNER,
    visibility: 'private',
    proposalReward: opts.proposalReward ?? 0,
    spamPenalty: opts.spamPenalty ?? 0,
    maxPendingProposalsPerParticipant: opts.maxPending ?? 0,
  });
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

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

async function statusOf(id: string): Promise<string> {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.workspaceId, WS)));
  return row.status;
}

describe('approveProposal', () => {
  test('with reward, debits owner and credits proposer', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 0, proposalReward: 20 });
    await insertProposal('p1');
    const result = await approveProposal('p1', WS, OWNER);
    expect(result.rewardPaid).toBe(20);
    expect(await balanceOf(OWNER)).toBeCloseTo(80);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(20);
    expect(await statusOf('p1')).toBe('approved');
  });

  test('with no reward configured, just flips status', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 0, proposalReward: 0 });
    await insertProposal('p1');
    const result = await approveProposal('p1', WS, OWNER);
    expect(result.rewardPaid).toBe(0);
    expect(await balanceOf(OWNER)).toBe(100);
    expect(await balanceOf(PROPOSER)).toBe(0);
    expect(await statusOf('p1')).toBe('approved');
  });

  test('with insufficient owner balance, throws and leaves status pending', async () => {
    await seed({ ownerBalance: 5, proposerBalance: 0, proposalReward: 20 });
    await insertProposal('p1');
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/insufficient/i);
    expect(await statusOf('p1')).toBe('pending');
    expect(await balanceOf(OWNER)).toBe(5);
    expect(await balanceOf(PROPOSER)).toBe(0);
  });

  test('rejects re-approving an already-resolved proposal', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 0, proposalReward: 20 });
    await insertProposal('p1', 'approved');
    await expect(approveProposal('p1', WS, OWNER)).rejects.toThrow(/not pending/i);
  });
});

describe('declineProposal (good faith)', () => {
  test('flips status to declined, no balance change, even with reward configured', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50, proposalReward: 20, spamPenalty: 10 });
    await insertProposal('p1');
    await declineProposal('p1', WS, OWNER);
    expect(await statusOf('p1')).toBe('declined');
    expect(await balanceOf(OWNER)).toBe(100);
    expect(await balanceOf(PROPOSER)).toBe(50);
  });
});

describe('declineProposalAsSpam', () => {
  test('charges proposer up to spamPenalty and credits owner', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50, spamPenalty: 10 });
    await insertProposal('p1');
    const result = await declineProposalAsSpam('p1', WS, OWNER);
    expect(result.penaltyCharged).toBeCloseTo(10);
    expect(await balanceOf(OWNER)).toBeCloseTo(110);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(40);
    expect(await statusOf('p1')).toBe('declined_spam');
  });

  test('caps charge at proposer available balance', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 3, spamPenalty: 10 });
    await insertProposal('p1');
    const result = await declineProposalAsSpam('p1', WS, OWNER);
    expect(result.penaltyCharged).toBeCloseTo(3);
    expect(await balanceOf(OWNER)).toBeCloseTo(103);
    expect(await balanceOf(PROPOSER)).toBeCloseTo(0);
    expect(await statusOf('p1')).toBe('declined_spam');
  });

  test('with spamPenalty=0, just flips status; no balance change', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50, spamPenalty: 0 });
    await insertProposal('p1');
    const result = await declineProposalAsSpam('p1', WS, OWNER);
    expect(result.penaltyCharged).toBe(0);
    expect(await balanceOf(OWNER)).toBe(100);
    expect(await balanceOf(PROPOSER)).toBe(50);
    expect(await statusOf('p1')).toBe('declined_spam');
  });
});

describe('withdrawProposal', () => {
  test('proposer can withdraw their own pending proposal', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50, spamPenalty: 10, proposalReward: 20 });
    await insertProposal('p1');
    await withdrawProposal('p1', WS, PROPOSER);
    expect(await statusOf('p1')).toBe('withdrawn');
    expect(await balanceOf(OWNER)).toBe(100);
    expect(await balanceOf(PROPOSER)).toBe(50);
  });

  test("non-proposer cannot withdraw someone else's proposal", async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50 });
    await insertProposal('p1');
    await expect(withdrawProposal('p1', WS, OWNER)).rejects.toThrow(/Only the proposer/i);
    expect(await statusOf('p1')).toBe('pending');
  });
});

describe('countPendingProposalsByProposer', () => {
  test('counts only pending proposals for the given proposer', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50 });
    await insertProposal('p1', 'pending');
    await insertProposal('p2', 'pending');
    await insertProposal('p3', 'approved');
    await insertProposal('p4', 'declined_spam');
    expect(await countPendingProposalsByProposer(WS, PROPOSER)).toBe(2);
    expect(await countPendingProposalsByProposer(WS, OWNER)).toBe(0);
  });
});

describe('marketplace 30-day proposalStats aggregation', () => {
  test('groups proposals by status for a given window', async () => {
    await seed({ ownerBalance: 100, proposerBalance: 50 });
    await insertProposal('p1', 'pending');
    await insertProposal('p2', 'approved');
    await insertProposal('p3', 'declined');
    await insertProposal('p4', 'declined_spam');
    await insertProposal('p5', 'declined_spam');
    await insertProposal('p6', 'withdrawn');

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        workspaceId: proposals.workspaceId,
        status: proposals.status,
        n: sql<number>`count(*)::int`,
      })
      .from(proposals)
      .where(and(inArray(proposals.workspaceId, [WS]), gte(proposals.createdAt, since)))
      .groupBy(proposals.workspaceId, proposals.status);

    const stats = { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 };
    for (const r of rows) {
      stats.total += r.n;
      if (r.status === 'approved') stats.approved += r.n;
      else if (r.status === 'declined') stats.declined += r.n;
      else if (r.status === 'declined_spam') stats.declinedSpam += r.n;
      else if (r.status === 'withdrawn') stats.withdrawn += r.n;
      else if (r.status === 'pending') stats.pending += r.n;
    }
    expect(stats).toEqual({ total: 6, approved: 1, declined: 1, declinedSpam: 2, withdrawn: 1, pending: 1 });
  });
});
