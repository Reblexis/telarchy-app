/**
 * The seam between "identity is global" and "data is per-store".
 *
 * `agents.auth_user_id` is a foreign key to the STORE'S OWN user table. Once
 * sessions started resolving against the account store, creating a
 * participant on the beta for a real account failed on
 * `agents_auth_user_id_user_id_fk`, and it surfaced as a bare "Internal
 * error" from /api/auth/me (beta, 2026-08-24). The beta gets a shadow of the
 * account row instead, under the same id, so everything it holds still
 * belongs to the real person.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mirrorAccountIntoStore } from '../db/client';
import { authUser } from '../db/schema';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

describe('mirroring an account', () => {
  test('does nothing where there is only one store', async () => {
    // Production, and the test harness: the account is already here, and a
    // copy would be a second row claiming the same id.
    await mirrorAccountIntoStore('user-1');
    expect(await db.select().from(authUser)).toHaveLength(0);
  });
});

describe('where the mirror is called', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

  test('at the point identity is established, both ways in', () => {
    // A grep, because the failure needs two live databases to reproduce, and
    // the way it comes back is a writer added without the call. Doing it in
    // the middleware rather than in each writer is what makes that
    // impossible: everything downstream already has its row.
    const mw = src('middleware/auth.ts');
    // Once for the strict path, once for the optional one.
    expect(mw.match(/mirrorAccountIntoStore\(session\.user\.id\)/g)).toHaveLength(2);
  });

  test('and before the one route that links an existing participant', () => {
    // Claiming a key-first identity points an agent at an account without
    // going through the session middleware first.
    expect(src('routes/onboard.ts')).toMatch(/mirrorAccountIntoStore\(uid\)/);
  });
});
