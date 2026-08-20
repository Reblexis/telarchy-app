jest.mock('../db/client', () => require('./harness/test-db'));

import request from 'supertest';
import { app } from '../app';

/**
 * Who may call this API from a browser, and what a refusal looks like.
 *
 * Two rules, both learned the hard way on 2026-08-20:
 *
 * 1. The brief and the question box are anonymous and exist to be embedded
 *    from another origin (LookPilot's data room). They must answer any origin,
 *    and must never carry `Allow-Credentials`, because `*` plus credentials is
 *    rejected by every browser and because these routes have no session to
 *    spend.
 * 2. Everything else keeps the allowlist, and a refusal is the ABSENCE of the
 *    allow header, not a 500. The old code handed cors an Error, which threw
 *    into the error handler, so a policy decision looked like an outage.
 */

const ALIEN = 'https://lookpilot.app';

describe('CORS policy', () => {
  const prev = process.env.ALLOWED_ORIGIN;
  beforeAll(() => { process.env.ALLOWED_ORIGIN = 'https://telarchy.com'; });
  afterAll(() => { process.env.ALLOWED_ORIGIN = prev; });

  test('a disallowed origin is refused by omission, never by a 500', async () => {
    const res = await request(app).get('/api/status').set('Origin', ALIEN);
    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('an allowed origin gets the header and credentials', async () => {
    const res = await request(app).get('/api/status').set('Origin', 'https://telarchy.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://telarchy.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('the brief answers any origin, without credentials', async () => {
    const res = await request(app)
      .get('/api/marketplace/lookpilot/context')
      .set('Origin', ALIEN);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    // `*` and Allow-Credentials together is rejected by browsers, so the
    // wildcard route must never claim credentials.
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('the question box preflight passes from another origin', async () => {
    const res = await request(app)
      .options('/api/marketplace/lookpilot/ask')
      .set('Origin', ALIEN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('a sibling marketplace route stays on the allowlist', async () => {
    // Only the brief and the question box are open. The rest of the floor's
    // public payload is same-origin, so widening it would be scope creep.
    const res = await request(app)
      .get('/api/marketplace/lookpilot/comments')
      .set('Origin', ALIEN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
