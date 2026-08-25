/**
 * Unit test for the GitHub install return path. After the OAuth / install
 * round-trip the callback must send the browser to the canonical
 * /{ownerHandle}/{slug}/sources?state= page (guarded by WorkspaceRouteGuard),
 * not the legacy flat /sources path that bounced through FlatTabRedirect to
 * /create-workspace. See workspaceSourcesReturnPath in routes/sources.ts.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { workspaceSourcesReturnPath } from '../routes/sources';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const OWNER = 'agent-owner-gh';
const WS = 'ws-gh-return';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(nickname?: string) {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-gh-return', balance: toUnits(0), nickname });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Q3 Growth',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
}

describe('workspaceSourcesReturnPath', () => {
  test('returns the canonical owner/slug sources path with the state preserved', async () => {
    await seed('acme-corp');
    const path = await workspaceSourcesReturnPath(WS, 'st4te');
    expect(path).toBe('/acme-corp/q3-growth/sources?state=st4te');
  });

  test('falls back to the owner id when the owner has no nickname', async () => {
    await seed();
    const path = await workspaceSourcesReturnPath(WS, 'st4te');
    expect(path).toBe(`/${OWNER}/q3-growth/sources?state=st4te`);
  });

  test('url-encodes the state token', async () => {
    await seed('acme-corp');
    const path = await workspaceSourcesReturnPath(WS, 'a b/c');
    expect(path).toBe('/acme-corp/q3-growth/sources?state=a%20b%2Fc');
  });

  test('falls back to the flat path for an unknown workspace', async () => {
    const path = await workspaceSourcesReturnPath('does-not-exist', 'st4te');
    expect(path).toBe('/sources?state=st4te');
  });
});
