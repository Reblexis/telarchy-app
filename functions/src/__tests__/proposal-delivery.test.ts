/**
 * After approval: whether the approved thing happened
 * (docs/guides/proposals.md, "After approval: say whether it happened").
 *
 * A conditional market prices "if this is approved, the metric lands at X".
 * Approval was the last thing the record held, so a forecaster could never
 * tell a market that was wrong from a promise that was not kept, and priced
 * both the same. The delivery state is what makes the conditional checkable
 * after the fact, which is why it is a public field with a state machine and
 * not a comment.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, proposals, workspaces } from '../db/schema';
import { toUnits } from '../lib/validation';
import { setProposalDelivery } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-delivery';
const OWNER = 'owner';
const PROPOSER = 'proposer';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-o', balance: toUnits(100) },
    { id: PROPOSER, apiKeyHash: 'h-p', balance: toUnits(100) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Floor', slug: 'floor', createdBy: OWNER, visibility: 'public' });
});

async function proposal(id: string, status: string) {
  await db.insert(proposals).values({
    id,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: 'Reach out to 30 founders',
    status,
    conditionalMarketIds: [],
    resolvedAt: status === 'pending' ? null : new Date('2026-09-01T00:00:00Z'),
  });
}

async function row(id: string) {
  const [r] = await db.select().from(proposals).where(eq(proposals.id, id));
  return r;
}

describe('the state an approved proposal starts in', () => {
  test('an approved proposal that nobody has spoken for has not started', async () => {
    await proposal('p1', 'approved');
    expect((await row('p1')).deliveryState).toBe('not_started');
    expect((await row('p1')).deliveredAt).toBeNull();
  });
});

describe('setting it', () => {
  test('in progress, with the owner’s own line about it', async () => {
    await proposal('p1', 'approved');
    await setProposalDelivery('p1', WS, { state: 'in_progress', note: 'started 6 Sep' });
    const r = await row('p1');
    expect(r.deliveryState).toBe('in_progress');
    expect(r.deliveryNote).toBe('started 6 Sep');
    expect(r.deliveredAt).toBeNull();
  });

  test('delivered stamps the day it was delivered', async () => {
    await proposal('p1', 'approved');
    const at = new Date('2026-09-02T09:00:00Z');
    await setProposalDelivery('p1', WS, { state: 'delivered', note: '30 written to, 4 replied' }, at);
    const r = await row('p1');
    expect(r.deliveryState).toBe('delivered');
    expect(r.deliveredAt?.toISOString()).toBe(at.toISOString());
  });

  test('moving back off delivered clears the stamp, because a date that outlives its state is a lie', async () => {
    await proposal('p1', 'approved');
    await setProposalDelivery('p1', WS, { state: 'delivered' }, new Date('2026-09-02T09:00:00Z'));
    await setProposalDelivery('p1', WS, { state: 'in_progress' });
    const r = await row('p1');
    expect(r.deliveryState).toBe('in_progress');
    expect(r.deliveredAt).toBeNull();
  });

  test('a note left out keeps the one already there; an empty note clears it', async () => {
    await proposal('p1', 'approved');
    await setProposalDelivery('p1', WS, { state: 'in_progress', note: 'started' });
    await setProposalDelivery('p1', WS, { state: 'delivered' });
    expect((await row('p1')).deliveryNote).toBe('started');
    await setProposalDelivery('p1', WS, { state: 'delivered', note: '' });
    expect((await row('p1')).deliveryNote).toBeNull();
  });
});

describe('what has no delivery state at all', () => {
  test('a pending proposal has nothing to report', async () => {
    await proposal('p1', 'pending');
    await expect(setProposalDelivery('p1', WS, { state: 'delivered' })).rejects.toThrow(/approved/i);
  });

  test('a declined proposal was never promised', async () => {
    await proposal('p1', 'declined');
    await expect(setProposalDelivery('p1', WS, { state: 'delivered' })).rejects.toThrow(/approved/i);
  });

  test('a proposal on another workspace is not this owner’s to speak for', async () => {
    await proposal('p1', 'approved');
    await expect(setProposalDelivery('p1', 'ws-someone-else', { state: 'delivered' })).rejects.toThrow(/not found/i);
  });
});

describe('what a state may be', () => {
  test('an unknown state is refused rather than written', async () => {
    await proposal('p1', 'approved');
    await expect(setProposalDelivery('p1', WS, { state: 'shipped' as never })).rejects.toThrow(/state/i);
    expect((await row('p1')).deliveryState).toBe('not_started');
  });

  test('a note longer than the cap is refused rather than truncated', async () => {
    await proposal('p1', 'approved');
    await expect(setProposalDelivery('p1', WS, { state: 'delivered', note: 'x'.repeat(1001) })).rejects.toThrow(
      /note/i,
    );
  });
});
