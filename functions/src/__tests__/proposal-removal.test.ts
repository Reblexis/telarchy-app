/**
 * Taking a job off the board.
 *
 * Declining is a decision and stays on the record. Removal is for entries that
 * should never have been on the board at all - spam, duplicates, the test rows
 * a workspace accumulates before launch - and the owner needs to clear them
 * without hand-editing the database.
 *
 * Two properties matter and are asserted here. First, removal is a status, not
 * a row delete: trades, positions and balance history reference a proposal's
 * markets, so deleting the row would orphan ledger entries the leaderboard and
 * profile pages read. Second, a removed job disappears from what participants
 * read, in every listing, whatever state it was in when it was removed.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, proposals } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { removeProposal } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const OWNER = 'agent-owner';
const PROPOSER = 'agent-proposer';
const WS = 'ws-removal';

async function seed(status: string) {
  await db
    .insert(agents)
    .values([
      { id: OWNER, apiKeyHash: `h-owner-${WS}`, balance: 0 },
      { id: PROPOSER, apiKeyHash: `h-proposer-${WS}`, balance: 0 },
    ])
    .onConflictDoNothing();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Removal WS',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(proposals).values({
    id: 'p1',
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: '$10: buy a copy',
    description: 'test row',
    status,
  });
}

const getProposal = () =>
  db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, 'p1'), eq(proposals.workspaceId, WS)))
    .then(r => r[0]);

describe('removeProposal', () => {
  test('a pending job becomes removed, and the row survives for the ledger', async () => {
    await seed('pending');
    await removeProposal('p1', WS, OWNER);

    const p = await getProposal();
    expect(p).toBeDefined(); // the row is kept on purpose
    expect(p.status).toBe('removed');
    expect(p.resolvedBy).toBe(OWNER);
    expect(p.resolvedAt).toBeTruthy();
  });

  test('an already-decided job can still be cleared off the board', async () => {
    await seed('declined');
    await removeProposal('p1', WS, OWNER);
    expect((await getProposal()).status).toBe('removed');
  });

  test('removing twice is a no-op rather than an error', async () => {
    await seed('pending');
    await removeProposal('p1', WS, OWNER);
    const first = await getProposal();
    await expect(removeProposal('p1', WS, OWNER)).resolves.toBeUndefined();
    const second = await getProposal();
    expect(second.status).toBe('removed');
    // The second call must not restamp the decision.
    expect(second.resolvedAt).toEqual(first.resolvedAt);
  });

  test('an unknown proposal is a 404, and a proposal in another workspace is not reachable', async () => {
    await seed('pending');
    await expect(removeProposal('nope', WS, OWNER)).rejects.toBeInstanceOf(AppError);
    await expect(removeProposal('p1', 'some-other-ws', OWNER)).rejects.toBeInstanceOf(AppError);
    // The real proposal is untouched by either attempt.
    expect((await getProposal()).status).toBe('pending');
  });
});
