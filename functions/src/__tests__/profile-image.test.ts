/**
 * The avatar on POST /api/auth/profile.
 *
 * The value lands in an <img src> for every viewer of the account menu, so
 * the endpoint is the only place that can keep a `javascript:` or `data:`
 * URL out. These tests pin that boundary, plus the two states the menu
 * relies on: setting a picture and clearing it.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The router pulls in the auth middleware (better-auth's ESM build); the
// tests drive identity directly, so stub it.
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser } from '../db/schema';
import { AppError } from '../lib/errors';
import { userauthRouter } from '../routes/userauth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const UID = 'user-avatar';
const AGENT = 'agent-avatar';

const app = express();
app.use(express.json());
// Minimal auth shim: a browser-session identity, the case the picture is for.
app.use((req: any, _res, next) => {
  req.auth = {
    uid: req.headers['x-no-uid'] ? null : UID,
    agentId: AGENT,
    workspaceId: 'ws-avatar',
    capabilities: new Set(['read', 'trade', 'manage']),
    scopes: ['*'],
  };
  next();
});
app.use('/api/auth', userauthRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values({
    id: UID,
    name: 'Avatar Tester',
    email: 'avatar@example.com',
    emailVerified: true,
  });
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h-avatar', balance: 0, authUserId: UID });
});

async function storedImage(): Promise<string | null> {
  const [row] = await db.select().from(authUser).where(eq(authUser.id, UID));
  return row?.image ?? null;
}

describe('profile picture', () => {
  test('an https URL is stored on the account row', async () => {
    const res = await request(app).post('/api/auth/profile').send({ image: 'https://example.com/me.png' });
    expect(res.status).toBe(200);
    expect(await storedImage()).toBe('https://example.com/me.png');
  });

  test('an empty string clears it', async () => {
    await request(app).post('/api/auth/profile').send({ image: 'https://example.com/me.png' });
    const res = await request(app).post('/api/auth/profile').send({ image: '' });
    expect(res.status).toBe(200);
    expect(await storedImage()).toBeNull();
  });

  test('a javascript: URL is refused, and nothing is written', async () => {
    const res = await request(app).post('/api/auth/profile').send({ image: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http or https/);
    expect(await storedImage()).toBeNull();
  });

  test('a data: URL is refused too', async () => {
    const res = await request(app).post('/api/auth/profile').send({ image: 'data:text/html;base64,PHNjcmlwdD4=' });
    expect(res.status).toBe(400);
    expect(await storedImage()).toBeNull();
  });

  test('garbage that is not a URL is refused', async () => {
    const res = await request(app).post('/api/auth/profile').send({ image: 'not a url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid URL/);
  });

  test('an over-long URL is refused', async () => {
    const res = await request(app)
      .post('/api/auth/profile')
      .send({ image: `https://example.com/${'x'.repeat(500)}.png` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500 characters/);
  });

  test('an API-key participant with no browser account gets a clear 400', async () => {
    const res = await request(app)
      .post('/api/auth/profile')
      .set('x-no-uid', '1')
      .send({ image: 'https://example.com/me.png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/browser account/);
  });

  test('other profile fields still work when no image is sent', async () => {
    const res = await request(app).post('/api/auth/profile').send({ bio: 'I price things.' });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.bio).toBe('I price things.');
  });
});

describe('payment details', () => {
  async function storedPayout(): Promise<string | null> {
    const [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    return row?.payoutHandle ?? null;
  }

  test('a handle is stored on the participant row', async () => {
    const res = await request(app).post('/api/auth/profile').send({ payoutHandle: '  pay@example.com  ' });
    expect(res.status).toBe(200);
    expect(await storedPayout()).toBe('pay@example.com');
  });

  test('empty string and null clear it; a too-short handle is refused', async () => {
    await request(app).post('/api/auth/profile').send({ payoutHandle: 'pay@example.com' });
    const cleared = await request(app).post('/api/auth/profile').send({ payoutHandle: '' });
    expect(cleared.status).toBe(200);
    expect(await storedPayout()).toBeNull();

    const short = await request(app).post('/api/auth/profile').send({ payoutHandle: 'abc' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/at least a few words/);
    expect(await storedPayout()).toBeNull();
  });
});

describe('inline data-URL picture', () => {
  test('a base64 jpeg data URL is stored', async () => {
    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(400);
    const res = await request(app).post('/api/auth/profile').send({ image: dataUrl });
    expect(res.status).toBe(200);
    expect(await storedImage()).toBe(dataUrl);
  });

  test('non-image data URLs and oversized images are refused', async () => {
    const html = await request(app).post('/api/auth/profile').send({ image: 'data:text/html;base64,PHNjcmlwdD4=' });
    expect(html.status).toBe(400);
    expect(await storedImage()).toBeNull();

    const big = await request(app)
      .post('/api/auth/profile')
      .send({ image: 'data:image/png;base64,' + 'A'.repeat(97_000) });
    expect(big.status).toBe(400);
    expect(await storedImage()).toBeNull();
  });
});

describe('structured payment method', () => {
  async function storedPayment(): Promise<{ handle: string | null; method: unknown }> {
    const [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    return { handle: row?.payoutHandle ?? null, method: row?.payoutMethod ?? null };
  }

  test('a valid method stores the object and derives the summary', async () => {
    const res = await request(app)
      .post('/api/auth/profile')
      .send({ payoutMethod: { provider: 'bank', iban: 'DE89 3704 0044 0532 0130 00', holder: 'Jan Novak' } });
    expect(res.status).toBe(200);
    const { handle, method } = await storedPayment();
    expect(method).toEqual({ provider: 'bank', iban: 'DE89370400440532013000', holder: 'Jan Novak' });
    expect(handle).toBe('Bank (IBAN): DE89370400440532013000, holder Jan Novak');
  });

  test('an invalid method is refused with the provider-specific reason', async () => {
    const res = await request(app)
      .post('/api/auth/profile')
      .send({ payoutMethod: { provider: 'bank', iban: 'DE00WRONG', holder: 'Jan' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/IBAN/);
    expect((await storedPayment()).method).toBeNull();
  });

  test('null clears both columns; a legacy bare handle becomes the other provider', async () => {
    await request(app)
      .post('/api/auth/profile')
      .send({ payoutMethod: { provider: 'paypal', email: 'p@x.com' } });
    const cleared = await request(app).post('/api/auth/profile').send({ payoutMethod: null });
    expect(cleared.status).toBe(200);
    expect(await storedPayment()).toEqual({ handle: null, method: null });

    const legacy = await request(app).post('/api/auth/profile').send({ payoutHandle: 'pay me by carrier pigeon' });
    expect(legacy.status).toBe(200);
    const { handle, method } = await storedPayment();
    expect(method).toEqual({ provider: 'other', details: 'pay me by carrier pigeon' });
    expect(handle).toBe('pay me by carrier pigeon');
  });
});

describe('account deletion wipes payment PII', () => {
  test('payout method, summary, bio, and nickname are gone after DELETE /me', async () => {
    await request(app)
      .post('/api/auth/profile')
      .send({ payoutMethod: { provider: 'paypal', email: 'p@x.com' }, bio: 'I stream sims.' });
    const res = await request(app).delete('/api/auth/me');
    expect(res.status).toBe(204);
    const [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.payoutHandle).toBeNull();
    expect(row.payoutMethod).toBeNull();
    expect(row.bio).toBeNull();
    expect(row.nickname).toBeNull();
    expect(row.authUserId).toBeNull();
  });
});
