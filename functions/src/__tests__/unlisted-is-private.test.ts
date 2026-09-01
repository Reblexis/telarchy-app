/**
 * THE RULE: `public` is the only visibility that answers a caller with no
 * identity. Unlisted grants a stranger exactly what private does, which is
 * nothing.
 *
 * A new floor is created `unlisted`, and `resolvePublicReadWorkspace` refused
 * only `private`, so an unlisted floor answered anonymous reads addressed by
 * id OR SLUG, case-insensitively, platform-wide - and the slug is derived
 * from the floor's name. A stranger who guessed a company name read every
 * metric name, description, formula and current value, plus up to 500 points
 * of history per metric.
 *
 * That was the DEFAULT a founder's floor was born with, which made it the
 * answer to the confidentiality question in TODOS.md (bug hunt 2026-08-31,
 * P0-7; owner decision 2026-09-01: "unlisted should be same as private ...
 * private but obviously visible to the owner").
 *
 * The second half of the rule is the half that has bitten before: the owner
 * must still get in. A private floor 403'd the person who had just created it
 * (owner report 2026-08-28), and unlisted was chosen as the default partly to
 * dodge that. So every case below has an owner counterpart.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { workspaces } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { resolvePublicReadWorkspace } from '../lib/public-read';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const OWNER = 'agent-vis-owner';

async function floor(id: string, slug: string, visibility: 'public' | 'unlisted' | 'private') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: id,
    name: slug,
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility,
  });
  await db.update(workspaces).set({ slug }).where(eq(workspaces.id, id));
}

describe('only a public floor answers a stranger', () => {
  test('an unlisted floor resolves for nobody, by id', async () => {
    await floor('ws-unlisted', 'acme', 'unlisted');
    expect(await resolvePublicReadWorkspace('ws-unlisted')).toBeNull();
  });

  test('an unlisted floor resolves for nobody, by the slug taken from its name', async () => {
    await floor('ws-unlisted', 'acme', 'unlisted');
    // The shape that made this reachable: guess the company name.
    expect(await resolvePublicReadWorkspace('acme')).toBeNull();
    expect(await resolvePublicReadWorkspace('ACME')).toBeNull();
  });

  test('a private floor still resolves for nobody', async () => {
    await floor('ws-private', 'quiet', 'private');
    expect(await resolvePublicReadWorkspace('ws-private')).toBeNull();
    expect(await resolvePublicReadWorkspace('quiet')).toBeNull();
  });

  test('a public floor still answers, by id and by slug', async () => {
    await floor('ws-public', 'open', 'public');
    expect(await resolvePublicReadWorkspace('ws-public')).toBe('ws-public');
    expect(await resolvePublicReadWorkspace('open')).toBe('ws-public');
    expect(await resolvePublicReadWorkspace('OPEN')).toBe('ws-public');
  });

  test('unlisted and private are indistinguishable to a stranger', async () => {
    await floor('ws-u', 'alpha', 'unlisted');
    await floor('ws-p', 'beta', 'private');
    expect(await resolvePublicReadWorkspace('alpha')).toBe(await resolvePublicReadWorkspace('beta'));
  });
});
