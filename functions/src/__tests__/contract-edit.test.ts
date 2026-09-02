/**
 * Editing a proposal: what a proposer may change, and what the market keeps
 * (docs/market-integrity.md, I1b).
 *
 * Words and price both edit in place and are published as revisions. The
 * ask re-anchors an untraded pair (void and respawn at the new number, free
 * because nobody is in it); a traded pair is never touched, since taking it
 * away from the people in it is what I2 forbids. Disclosure, not
 * prevention: the revision row is the record a holder trades on.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics, positions, proposalRevisions, proposals, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { editProposalDefinition, proposalRevisionsFor } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-proposal-edit';
const PROPOSER = 'agent-proposer';
const OTHER = 'agent-other';
const OWNER = 'agent-owner';
const METRIC = 'metric-rev';
const PROPOSAL = 'proposal-1';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: PROPOSER, apiKeyHash: 'h-p', balance: toUnits(1000) },
    { id: OTHER, apiKeyHash: 'h-o', balance: toUnits(1000) },
    { id: OWNER, apiKeyHash: 'h-w', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Floor',
    slug: 'floor',
    createdBy: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Net revenue (USD)',
    value: 1000,
    formula: '0',
    marketRangeMax: 5000,
  });
  await db.insert(proposals).values({
    id: PROPOSAL,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: '$200: rewrite the store page',
    description: 'Five languages.',
    askUsd: 200,
    status: 'pending',
    conditionalMarketIds: [],
    payoutHandle: 'paid@example.com',
    createdAt: new Date(),
  });
});

const asProposer = { agentId: PROPOSER, canManage: false };
const asOwner = { agentId: OWNER, canManage: true };
const asStranger = { agentId: OTHER, canManage: false };

/** An untraded branch pair, as createConditionalMarkets would leave it. */
async function seedPair(opts: { traded?: boolean } = {}) {
  for (const [id, branch] of [
    ['mkt-approved', 'approved'],
    ['mkt-declined', 'declined'],
  ] as const) {
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Net revenue (USD)',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 5000,
      shares: [0, 0],
      liquidity: 500,
      pool: initialPool(500),
      active: true,
      resolved: false,
      voided: false,
      proposalId: PROPOSAL,
      branch,
    });
  }
  await db
    .update(proposals)
    .set({ conditionalMarketIds: ['mkt-approved', 'mkt-declined'] })
    .where(eq(proposals.id, PROPOSAL));
  if (opts.traded) {
    await db.insert(trades).values({
      id: 'trade-1',
      workspaceId: WS,
      agentId: OTHER,
      marketId: 'mkt-approved',
      direction: 'higher',
      shares: 10,
      cost: 5,
      createdAt: new Date(),
    });
    await db.insert(positions).values({
      id: 'pos-1',
      workspaceId: WS,
      agentId: OTHER,
      marketId: 'mkt-approved',
      direction: 'higher',
      shares: 10,
      totalCost: 5,
    });
  }
}

const reload = async () => (await db.select().from(proposals).where(eq(proposals.id, PROPOSAL)))[0];

describe('who may edit a proposal', () => {
  test('the proposer may', async () => {
    await editProposalDefinition(PROPOSAL, WS, { description: 'Now six languages.' }, asProposer);
    expect((await reload()).description).toBe('Now six languages.');
  });

  test('a workspace manager may', async () => {
    await editProposalDefinition(PROPOSAL, WS, { description: 'Owner clarified.' }, asOwner);
    expect((await reload()).description).toBe('Owner clarified.');
  });

  test('a stranger may not', async () => {
    await expect(editProposalDefinition(PROPOSAL, WS, { description: 'mine now' }, asStranger)).rejects.toMatchObject({
      status: 403,
    });
    expect((await reload()).description).toBe('Five languages.');
  });

  test('a decided proposal is closed to edits', async () => {
    await db.update(proposals).set({ status: 'approved' }).where(eq(proposals.id, PROPOSAL));
    await expect(
      editProposalDefinition(PROPOSAL, WS, { description: 'after the fact' }, asProposer),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('the words edit in place and are published', () => {
  test('editing the description keeps the pair and its positions', async () => {
    await seedPair({ traded: true });
    await editProposalDefinition(PROPOSAL, WS, { description: 'Reworded.' }, asProposer);

    const open = await db
      .select()
      .from(markets)
      .where(and(eq(markets.proposalId, PROPOSAL), eq(markets.voided, false)));
    expect(open).toHaveLength(2);
    const held = await db.select().from(positions).where(eq(positions.marketId, 'mkt-approved'));
    expect(held).toHaveLength(1);
  });

  test('every change writes an append-only revision', async () => {
    await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: '$200: rewrite the store page in five languages',
        description: 'Reworded.',
      },
      asProposer,
    );
    const revs = await proposalRevisionsFor(PROPOSAL, WS);
    expect(revs.map(r => r.field).sort()).toEqual(['description', 'title']);
    const title = revs.find(r => r.field === 'title')!;
    expect(title.oldValue).toBe('$200: rewrite the store page');
    expect(title.newValue).toBe('$200: rewrite the store page in five languages');
    expect(title.changedBy).toBe(PROPOSER);
  });

  test('re-saving identical text writes nothing', async () => {
    const result = await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: '$200: rewrite the store page',
        description: 'Five languages.',
      },
      asProposer,
    );
    expect(result.changed).toEqual([]);
    expect(await db.select().from(proposalRevisions)).toHaveLength(0);
  });
});

describe('the price is machinery', () => {
  test('changing the ask on an untraded pair re-anchors it', async () => {
    await seedPair();
    const result = await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: '$300: rewrite the store page',
        askUsd: 300,
      },
      asProposer,
    );
    expect(result.reanchored).toBe(true);
    expect((await reload()).askUsd).toBe(300);

    // The old pair is gone and a fresh one opened at the new number.
    const voided = await db
      .select()
      .from(markets)
      .where(and(eq(markets.proposalId, PROPOSAL), eq(markets.voided, true)));
    expect(voided.length).toBeGreaterThan(0);
  });

  test('changing the ask after anyone has traded keeps the pair and its positions', async () => {
    // Owner decision 2026-08-22: the ask stays editable after trading. The
    // markets are NOT re-anchored, because voiding a traded pair takes it
    // away from the people in it; the revision row is the disclosure.
    await seedPair({ traded: true });
    const result = await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: '$300: rewrite the store page',
        askUsd: 300,
      },
      asProposer,
    );
    expect(result.changed).toContain('askUsd');
    expect(result.reanchored).toBe(false);
    expect((await reload()).askUsd).toBe(300);

    // The pair stands exactly where trading put it: nothing voided, the
    // position still held.
    const voided = await db
      .select()
      .from(markets)
      .where(and(eq(markets.proposalId, PROPOSAL), eq(markets.voided, true)));
    expect(voided).toHaveLength(0);
    const held = await db.select().from(positions).where(eq(positions.marketId, 'mkt-approved'));
    expect(held).toHaveLength(1);

    // And the move is on the record.
    const revs = await proposalRevisionsFor(PROPOSAL, WS);
    const ask = revs.find(r => r.field === 'askUsd')!;
    expect(ask.oldValue).toBe('200');
    expect(ask.newValue).toBe('300');
  });

  test('a workspace manager can move the ask too, traded or not', async () => {
    // The owner edits any proposal with the same rules as its proposer
    // (owner ask 2026-08-22: "add support for the workspace owner to edit
    // proposals as well, including price").
    await seedPair({ traded: true });
    const result = await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: '$250: rewrite the store page',
        askUsd: 250,
      },
      asOwner,
    );
    expect(result.changed).toContain('askUsd');
    expect((await reload()).askUsd).toBe(250);
    const revs = await proposalRevisionsFor(PROPOSAL, WS);
    expect(revs.find(r => r.field === 'askUsd')?.changedBy).toBe(OWNER);
  });

  test('the words are still editable on a traded proposal', async () => {
    await seedPair({ traded: true });
    const result = await editProposalDefinition(PROPOSAL, WS, { description: 'Clarified.' }, asProposer);
    expect(result.changed).toEqual(['description']);
    expect(result.reanchored).toBe(false);
  });
});

describe('one price, stated once', () => {
  test('a title that names a different price than the ask is refused', async () => {
    await expect(
      editProposalDefinition(
        PROPOSAL,
        WS,
        {
          title: '$300: rewrite the store page',
          askUsd: 250,
        },
        asProposer,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('a priced title on a free proposal is refused', async () => {
    await expect(
      editProposalDefinition(
        PROPOSAL,
        WS,
        {
          title: '$200: rewrite the store page',
          askUsd: 0,
        },
        asProposer,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('dropping the price drops the prefix', async () => {
    await seedPair();
    await editProposalDefinition(
      PROPOSAL,
      WS,
      {
        title: 'rewrite the store page',
        askUsd: 0,
      },
      asProposer,
    );
    const row = await reload();
    expect(row.askUsd).toBeNull();
    expect(row.title).toBe('rewrite the store page');
  });
});
