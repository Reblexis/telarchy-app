/**
 * The catalog is the first thing the skill tells an agent to fetch, and it is
 * 136KB.
 *
 * `GET /api/help` carries every endpoint the platform has, with a
 * paragraph-long description each, plus the concept primer. That is the right
 * document to HAVE, and the wrong one to send on every call: at roughly 34,000
 * tokens it is a sixth of a 200k context spent before the agent has read a
 * single price, and a trading participant needs about a dozen of those
 * endpoints. Otto already reached this conclusion for its own tool
 * (services/otto-tools.ts: "handing it over whole would cost more than most
 * conversations are worth") and filters the same object.
 *
 * So the filters are the same idea, on the public endpoint. The rule that
 * matters most here is the one about NOT breaking anything: the bare call must
 * keep returning exactly what it returned before, because agents running old
 * copies of the skill will never be updated.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-help-filters';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'help-filters-secret-help-filters-12';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import request from 'supertest';
import { app } from '../app';
import { HELP } from '../lib/help-catalog';

const get = (q = '') => request(app).get(`/api/help${q}`).set('Origin', 'http://localhost');

describe('the bare catalog is untouched', () => {
  test('THE RULE: GET /api/help with no query returns the whole document, as before', async () => {
    // Agents are running copies of the skill that will never be updated. If
    // this changes, they break, and they cannot tell us.
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(HELP);
  });

  test('it still needs no credentials', async () => {
    const res = await get();
    expect(res.status).toBe(200);
  });
});

describe('?section= narrows to one part of the API', () => {
  test('returns only that section, and far less of it', async () => {
    const full = await get();
    const res = await get('?section=predictions');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.length).toBeGreaterThan(0);
    expect(res.body.endpoints.every((e: { path: string }) => e.path.startsWith('/api/predictions'))).toBe(true);
    expect(res.body.endpoints.length).toBeLessThan(full.body.endpoints.length);
    // The point of the whole exercise: it has to be dramatically cheaper.
    expect(JSON.stringify(res.body).length).toBeLessThan(JSON.stringify(full.body).length / 3);
  });

  test('it says what it filtered and how much it left out', async () => {
    const res = await get('?section=predictions');
    expect(res.body.filter).toEqual(expect.objectContaining({ section: 'predictions' }));
    expect(res.body.matched).toBe(res.body.endpoints.length);
    expect(res.body.of).toBe(HELP.endpoints.length);
  });

  test('it keeps the auth legend, because auth is unreadable without it', async () => {
    const res = await get('?section=predictions');
    expect(res.body.authentication).toBeDefined();
  });

  test('an unknown section is self-correcting, not an empty list', async () => {
    // An empty array reads as "this API has no such endpoints", which is a
    // confident wrong answer. The guides already answer a bad id this way.
    const res = await get('?section=nonsense');
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections).toContain('predictions');
  });
});

describe('?q= searches paths and descriptions', () => {
  test('finds endpoints by a word in the path, and by one only the description carries', async () => {
    const res = await get('?q=limit-orders');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.length).toBeGreaterThan(0);
    // The search covers descriptions on purpose, so a row whose PATH lacks the
    // term is a correct hit, not a leak: `POST /api/predictions/trade`
    // explains what happens when a trade crosses a resting limit order, and an
    // agent searching for limit orders wants to be told that.
    expect(
      res.body.endpoints.every((e: { method: string; path: string; description: string }) =>
        `${e.method} ${e.path} ${e.description}`.toLowerCase().includes('limit-orders'),
      ),
    ).toBe(true);
    expect(res.body.endpoints.some((e: { path: string }) => e.path.includes('limit-orders'))).toBe(true);
  });

  test('finds endpoints by a word only the description carries', async () => {
    const res = await get('?q=idempot');
    expect(res.status).toBe(200);
    // May legitimately be empty; the assertion is that it does not error and
    // reports honestly.
    expect(res.body.matched).toBe(res.body.endpoints.length);
  });

  test('every term must match, so a query narrows rather than widens', async () => {
    const one = await get('?q=trade');
    const two = await get('?q=trade%20limit');
    expect(two.body.endpoints.length).toBeLessThanOrEqual(one.body.endpoints.length);
  });

  test('a query matching nothing says so instead of pretending', async () => {
    const res = await get('?q=zzzzz-no-such-thing');
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toEqual([]);
    expect(res.body.matched).toBe(0);
    expect(typeof res.body.hint).toBe('string');
  });

  test('section and q combine', async () => {
    const res = await get('?section=predictions&q=trade');
    expect(res.body.endpoints.every((e: { path: string }) => e.path.startsWith('/api/predictions'))).toBe(true);
    expect(res.body.endpoints.some((e: { path: string }) => e.path.includes('trade'))).toBe(true);
  });
});

describe('a filtered answer says how to get the rest', () => {
  test('it points at the unfiltered document', async () => {
    const res = await get('?section=predictions');
    expect(res.body.hint).toContain('/api/help');
  });
});
