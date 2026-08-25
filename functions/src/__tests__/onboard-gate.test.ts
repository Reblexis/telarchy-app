/**
 * `POST /api/onboard` stays paused (vision.md, "The owner side reopens",
 * 2026-08-21).
 *
 * Workspace creation reopened that day, but through `POST /api/workspaces`,
 * which needs an account to charge the cap against
 * (`workspace-self-serve.test.ts`). Onboard is the UNAUTHENTICATED path: it
 * mints an identity and a workspace in one call, so a script needs nothing at
 * all to open floors with it and there is no account for a cap to count. It
 * reopens by flipping OWNER_ONBOARDING_OPEN, and vision.md owns that decision.
 *
 * The refusal must carry the pointer, because for an API caller the 403 IS the
 * signpost to the path that does work.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The route imports the auth middleware, which pulls in better-auth's ESM
// build; jest cannot require it. The gate under test runs before any auth.
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

import express from 'express';
import request from 'supertest';
import { ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

describe('onboard gate', () => {
  test('POST /api/onboard is paused with a pointer to the owner door', async () => {
    // OWNER_ONBOARDING_OPEN is unset in this file's module registry, so the
    // route loads with the gate closed, exactly as in production.
    const { onboardRouter } = require('../routes/onboard');
    const onboardApp = express();
    onboardApp.use(express.json());
    onboardApp.use('/api/onboard', onboardRouter);

    const res = await request(onboardApp)
      .post('/api/onboard')
      .send({ workspace: { name: 'X' } });

    expect(res.status).toBe(403);
    expect(res.body.waitlist).toBe('https://telarchy.com/manage');
  });
});
