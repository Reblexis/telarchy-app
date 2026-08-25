import express from 'express';
import request from 'supertest';
import { corsMiddleware } from '../lib/cors';

/**
 * Who may call this API from a browser, and what a refusal looks like.
 *
 * Two rules, both learned on 2026-08-20 while wiring LookPilot's data room to
 * the question box:
 *
 * 1. The brief and the question box are anonymous and exist to be embedded
 *    from another origin. They must answer any origin, and must never carry
 *    `Allow-Credentials`, because `*` plus credentials is rejected by every
 *    browser and because these routes have no session to spend.
 * 2. Everything else keeps the allowlist, and a refusal is the ABSENCE of the
 *    allow header, not a 500. The old code handed cors an Error, which threw
 *    into the error handler, so a policy decision answered `500 Internal
 *    error` and looked like an outage.
 *
 * Mounted on a bare express app rather than the real one: the policy is the
 * subject, and importing the whole app drags in BetterAuth's ESM build.
 */

const ALIEN = 'https://lookpilot.app';

function appWith(): express.Express {
  const app = express();
  app.use(corsMiddleware);
  app.get('/api/status', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/marketplace/:id', (_req, res) => {
    res.json({ floor: true });
  });
  app.get('/api/marketplace/:id/context', (_req, res) => {
    res.json({ brief: true });
  });
  app.post('/api/marketplace/:id/ask', (_req, res) => {
    res.json({ answer: 'yes' });
  });
  app.get('/api/marketplace/:id/comments', (_req, res) => {
    res.json([]);
  });
  return app;
}

describe('CORS policy', () => {
  const prev = process.env.ALLOWED_ORIGIN;
  beforeAll(() => {
    process.env.ALLOWED_ORIGIN = 'https://telarchy.com';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = prev;
  });

  test('a disallowed origin is refused by omission, never by a 500', async () => {
    const res = await request(appWith()).get('/api/status').set('Origin', ALIEN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('an allowed origin gets the header and may send credentials', async () => {
    const res = await request(appWith()).get('/api/status').set('Origin', 'https://telarchy.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://telarchy.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('the brief answers any origin, without credentials', async () => {
    const res = await request(appWith()).get('/api/marketplace/lookpilot/context').set('Origin', ALIEN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('the question box preflight passes from another origin', async () => {
    const res = await request(appWith())
      .options('/api/marketplace/lookpilot/ask')
      .set('Origin', ALIEN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test("a floor's public payload answers any origin, so the data room's freshness check can run", async () => {
    // It was fetched from lookpilot.app and refused from the day it shipped,
    // so the "this page says X and the market says Y" banner never once ran.
    const res = await request(appWith()).get('/api/marketplace/lookpilot').set('Origin', ALIEN);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('a sibling marketplace route stays on the allowlist', async () => {
    // Only the brief and the question box are open. The rest of the floor's
    // public payload is read same-origin, so widening it would be scope creep
    // on the credentialed surface.
    const res = await request(appWith()).get('/api/marketplace/lookpilot/comments').set('Origin', ALIEN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
