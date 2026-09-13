/**
 * A starved request fails as a 500 on its own; the instance keeps serving
 * (docs/infra/deploy.md, "And it shares the database's connection budget").
 *
 * On 2026-09-13 the pool gave up on an acquire inside the credential check.
 * apiAuthPolicy had started that check with `void`, so the rejection was
 * nobody's, Node ended the process, and every request on the instance died
 * with it. The traffic moved to the other instances, their pools starved, and
 * they ended too: ten minutes of 503s from one slow minute.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-crash';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'crash-secret-crash-secret-123456';

const poolTimeout = () => new Error('timeout exceeded when trying to connect');

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'stub' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  optionalAuthMiddleware: jest.fn(async () => {
    throw poolTimeout();
  }),
  authMiddleware: jest.fn(async () => {
    throw poolTimeout();
  }),
}));

import request from 'supertest';
import { app } from '../app';
import { isOptionalAuthPath } from '../middleware/route-policy';
import { ensureMigrations, truncateAll } from './harness/test-db';

const OPTIONAL_PATH = '/api/leaderboard';
const REQUIRED_PATH = '/api/predictions/positions';

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeAll(async () => {
  await ensureMigrations();
  await truncateAll();
  process.on('unhandledRejection', onUnhandled);
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
});

beforeEach(() => {
  unhandled.length = 0;
});

/** Let any rejection nobody handled surface as an event before we count. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('A DATABASE ERROR WHILE READING CREDENTIALS FAILS THAT REQUEST ALONE AND NEVER ENDS THE PROCESS', () => {
  test('the paths used here are one optional-auth path and one required-auth path', () => {
    expect(isOptionalAuthPath(OPTIONAL_PATH)).toBe(true);
    expect(isOptionalAuthPath(REQUIRED_PATH)).toBe(false);
  });

  test('the site went down for ten minutes when the database was slow for one (2026-09-13): an optional-auth read answers 500', async () => {
    const res = await request(app).get(OPTIONAL_PATH).timeout(4000);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error' });
    await settle();
    expect(unhandled).toEqual([]);
  });

  test('a required-auth read answers 500 the same way', async () => {
    const res = await request(app).get(REQUIRED_PATH).set('x-agent-key', 'any').timeout(4000);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error' });
    await settle();
    expect(unhandled).toEqual([]);
  });

  test('the driver text never reaches the caller', async () => {
    const res = await request(app).get(OPTIONAL_PATH).timeout(4000);
    expect(JSON.stringify(res.body)).not.toContain('timeout exceeded');
  });

  test('many requests failing at once each get their own answer, and none is left unhandled', async () => {
    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .get(i % 2 ? OPTIONAL_PATH : REQUIRED_PATH)
          .timeout(4000),
      ),
    );
    expect(answers.map(a => a.status)).toEqual(Array(20).fill(500));
    await settle();
    expect(unhandled).toEqual([]);
  });
});
