/**
 * The charter's promise, enforced.
 *
 * A workspace that publishes a `charter` is telling participants that a
 * proposal either ships or gets a written reason. Before this, declineProposal
 * took no reason at all and the proposals table had nowhere to store one, so
 * the promise degraded into a chat message nobody could find later.
 *
 * The rule: declineReason is required exactly when the workspace has a charter.
 * That coupling is the point. Requiring it everywhere would break existing API
 * clients and add friction to workspaces that promised nothing; requiring it
 * nowhere leaves the one public commitment the product sells unenforceable.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { declineProposal, MAX_DECLINE_REASON } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const OWNER = 'agent-owner';
const PROPOSER = 'agent-proposer';

async function seed(wsId: string, charter: string | null) {
  await db
    .insert(agents)
    .values([
      { id: OWNER, apiKeyHash: `h-owner-${wsId}`, balance: 0 },
      { id: PROPOSER, apiKeyHash: `h-proposer-${wsId}`, balance: 0 },
    ])
    .onConflictDoNothing();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId,
    name: `WS ${wsId}`,
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  if (charter !== null) {
    await db.update(workspaces).set({ charter }).where(eq(workspaces.id, wsId));
  }
  await db.insert(proposals).values({
    id: 'p1',
    workspaceId: wsId,
    proposedBy: PROPOSER,
    title: 'Ship offline mode',
    description: '',
    status: 'pending',
  });
}

function getProposal(wsId: string) {
  return db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, 'p1'), eq(proposals.workspaceId, wsId)))
    .then(r => r[0]);
}

describe('declineReason is gated on the workspace charter', () => {
  test('a charter workspace refuses a decline with no reason, and the proposal stays pending', async () => {
    await seed('ws-charter', 'I ship what the market ranks highest, or I say why.');

    await expect(declineProposal('p1', 'ws-charter', OWNER)).rejects.toThrow(AppError);
    await expect(declineProposal('p1', 'ws-charter', OWNER)).rejects.toThrow(/requires a written declineReason/);

    // The important half: a rejected decline must not half-apply.
    const p = await getProposal('ws-charter');
    expect(p.status).toBe('pending');
    expect(p.declineReason).toBeNull();
  });

  test('whitespace is not a reason', async () => {
    await seed('ws-charter-2', 'A charter.');
    await expect(declineProposal('p1', 'ws-charter-2', OWNER, '   \n  ')).rejects.toThrow(
      /requires a written declineReason/,
    );
    expect((await getProposal('ws-charter-2')).status).toBe('pending');
  });

  test('a charter workspace accepts a decline with a reason and stores it trimmed', async () => {
    await seed('ws-charter-3', 'A charter.');

    await declineProposal('p1', 'ws-charter-3', OWNER, '  It breaks the Steam Distribution Agreement.  ');

    const p = await getProposal('ws-charter-3');
    expect(p.status).toBe('declined');
    expect(p.declineReason).toBe('It breaks the Steam Distribution Agreement.');
    expect(p.resolvedBy).toBe(OWNER);
    expect(p.resolvedAt).not.toBeNull();
  });

  test('a workspace with no charter still declines without a reason', async () => {
    await seed('ws-plain', null);

    await declineProposal('p1', 'ws-plain', OWNER);

    const p = await getProposal('ws-plain');
    expect(p.status).toBe('declined');
    expect(p.declineReason).toBeNull();
  });

  test('a workspace with no charter may still give a reason', async () => {
    await seed('ws-plain-2', null);

    await declineProposal('p1', 'ws-plain-2', OWNER, 'Too expensive for now.');

    expect((await getProposal('ws-plain-2')).declineReason).toBe('Too expensive for now.');
  });

  test('an over-long reason is rejected before anything is written', async () => {
    await seed('ws-charter-4', 'A charter.');

    await expect(declineProposal('p1', 'ws-charter-4', OWNER, 'x'.repeat(MAX_DECLINE_REASON + 1))).rejects.toThrow(
      /at most 4000 characters/,
    );

    expect((await getProposal('ws-charter-4')).status).toBe('pending');
  });

  test('a reason at exactly the limit is accepted', async () => {
    await seed('ws-charter-5', 'A charter.');

    await declineProposal('p1', 'ws-charter-5', OWNER, 'x'.repeat(MAX_DECLINE_REASON));

    const p = await getProposal('ws-charter-5');
    expect(p.status).toBe('declined');
    expect((p.declineReason as string).length).toBe(MAX_DECLINE_REASON);
  });

  test('an already-declined proposal cannot be re-declined to overwrite the reason', async () => {
    await seed('ws-charter-6', 'A charter.');
    await declineProposal('p1', 'ws-charter-6', OWNER, 'The original reason.');

    await expect(declineProposal('p1', 'ws-charter-6', OWNER, 'A more convenient reason.')).rejects.toThrow(
      /only decline pending proposals/i,
    );

    expect((await getProposal('ws-charter-6')).declineReason).toBe('The original reason.');
  });
});
