/**
 * Announcements by email (docs/announcements-by-email.md).
 *
 * A broadcast is the mail nobody asked for, so the rules it has to keep are
 * the ones that protect the person receiving it and the operator's ability to
 * answer for it afterwards: it can be stopped without a login, it never
 * arrives twice, and every single address ends the run with a row saying what
 * happened to it.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

const sent: Array<{ to: string; subject: string; text: string; headers?: Record<string, string>; replyTo?: string }> =
  [];
let failFor = new Set<string>();
jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  sendEmail: jest.fn(
    async (
      to: string,
      subject: string,
      text: string,
      opts?: { headers?: Record<string, string>; replyTo?: string },
    ) => {
      sent.push({ to, subject, text, headers: opts?.headers, replyTo: opts?.replyTo });
      return !failFor.has(to);
    },
  ),
  notifyOwner: jest.fn(async () => {}),
}));

let platform = true;
jest.mock('../lib/platform-admin', () => ({ isPlatformAuthorized: async () => platform }));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, broadcastSends, emailOptOuts, prizeSeasons, seasonEntries } from '../db/schema';
import { AppError } from '../lib/errors';
import { unsubscribeToken } from '../lib/unsubscribe';
import { adminBroadcastsRouter } from '../routes/broadcasts';
import { unsubscribeRouter } from '../routes/unsubscribe';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const SEASON = 'season-b';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = { agentId: 'admin-b', uid: 'user-admin', capabilities: new Set(['read']), isMasterKey: true };
  next();
});
app.use('/api/admin/broadcasts', adminBroadcastsRouter);
app.use('/api/unsubscribe', unsubscribeRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  failFor = new Set();
  platform = true;
  process.env.BROADCAST_SECRET = 'test-secret';
  await seed();
});

/** Three entrants who opted in, one who did not, one with no address at all. */
async function seed(extra: Array<{ agentId: string; email: string | null; optedIn: boolean }> = []) {
  await db.insert(prizeSeasons).values({
    id: SEASON,
    name: 'Season 0',
    startsAt: new Date('2026-08-22'),
    endsAt: new Date('2026-10-02'),
    poolUsd: 1000,
    payoutMode: 'proportional',
    minPayoutUsd: 1,
    ladder: [],
    workspaceIds: [],
    rulesUrl: '/legal/season-0',
    status: 'running',
  } as never);
  const people = [
    { agentId: 'a-1', email: 'one@example.com', optedIn: true },
    { agentId: 'a-2', email: 'two@example.com', optedIn: true },
    { agentId: 'a-3', email: 'three@example.com', optedIn: true },
    { agentId: 'a-out', email: 'out@example.com', optedIn: false },
    { agentId: 'a-none', email: null, optedIn: true },
    ...extra,
  ];
  await db.insert(agents).values(people.map(p => ({ id: p.agentId, apiKeyHash: `h-${p.agentId}` })));
  await db.insert(seasonEntries).values(
    people.map(p => ({
      seasonId: SEASON,
      agentId: p.agentId,
      optedIn: p.optedIn,
      contactEmail: p.email,
      baselineProfit: 0,
    })) as never,
  );
}

const post = (body: Record<string, unknown>) => request(app).post('/api/admin/broadcasts').send(body);
const MESSAGE = { subject: 'A new game on Telarchy', body: 'The snake is live.', audience: 'season-entrants' as const };
const rowsFor = (id: string) => db.select().from(broadcastSends).where(eq(broadcastSends.broadcastId, id));

describe('WHO A BROADCAST REACHES', () => {
  test('one message per opted-in entrant, at the address on the entry', async () => {
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(r.status).toBe(200);
    expect(sent.map(s => s.to).sort()).toEqual(['one@example.com', 'three@example.com', 'two@example.com']);
    expect(r.body.sent).toBe(3);
    expect(sent[0].subject).toBe('A new game on Telarchy');
  });

  test('an entrant who did not opt in is not written to', async () => {
    await post({ ...MESSAGE, seasonId: SEASON });
    expect(sent.map(s => s.to)).not.toContain('out@example.com');
  });

  test('an entrant with no address is counted as unreachable, never skipped quietly', async () => {
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(r.body.unreachable).toBe(1);
  });

  test('dryRun resolves the audience and sends nothing', async () => {
    const r = await post({ ...MESSAGE, seasonId: SEASON, dryRun: true });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(r.body.recipients.sort()).toEqual(['one@example.com', 'three@example.com', 'two@example.com']);
    expect(await rowsFor(r.body.broadcastId ?? '')).toHaveLength(0);
  });
});

describe('NOTHING IS SILENTLY DROPPED', () => {
  test('every recipient ends with a row saying what happened', async () => {
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    const rows = await rowsFor(r.body.broadcastId);
    expect(rows.map(x => x.email).sort()).toEqual(['one@example.com', 'three@example.com', 'two@example.com']);
    expect(rows.every(x => x.status === 'sent')).toBe(true);
  });

  test('a provider failure is recorded as failed and counted, not swallowed', async () => {
    failFor = new Set(['two@example.com']);
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(r.body.sent).toBe(2);
    expect(r.body.failed).toBe(1);
    const rows = await rowsFor(r.body.broadcastId);
    expect(rows.find(x => x.email === 'two@example.com')?.status).toBe('failed');
  });

  test('THE SAME ADDRESS IS NEVER WRITTEN TO TWICE: a retry finishes the job', async () => {
    failFor = new Set(['two@example.com']);
    const first = await post({ ...MESSAGE, seasonId: SEASON });
    sent.length = 0;
    failFor = new Set();
    const again = await post({ ...MESSAGE, seasonId: SEASON, broadcastId: first.body.broadcastId });
    expect(sent.map(s => s.to)).toEqual(['two@example.com']);
    expect(again.body.sent).toBe(1);
    const rows = await rowsFor(first.body.broadcastId);
    expect(rows).toHaveLength(3);
    expect(rows.every(x => x.status === 'sent')).toBe(true);
  });
});

describe('EVERY BROADCAST CAN BE STOPPED', () => {
  test('the headers carry a one-click URL, a mailto, and the One-Click post', async () => {
    await post({ ...MESSAGE, seasonId: SEASON });
    const h = sent[0].headers ?? {};
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(h['List-Unsubscribe']).toContain('<https://telarchy.com/api/unsubscribe/');
    expect(h['List-Unsubscribe']).toContain('<mailto:');
  });

  test('the body says how to stop it as well, for a client that shows no header', async () => {
    await post({ ...MESSAGE, seasonId: SEASON });
    expect(sent[0].text).toContain('https://telarchy.com/api/unsubscribe/');
  });

  test('replies reach a mailbox somebody reads', async () => {
    await post({ ...MESSAGE, seasonId: SEASON, replyTo: 'support@telarchy.com' });
    expect(sent[0].replyTo).toBe('support@telarchy.com');
  });

  test('ONE CLICK STOPS IT WITHOUT A LOGIN: POST unsubscribes and answers 200', async () => {
    const token = unsubscribeToken('one@example.com');
    const r = await request(app).post(`/api/unsubscribe/${token}`);
    expect(r.status).toBe(200);
    const outs = await db.select().from(emailOptOuts);
    expect(outs.map(o => o.email)).toEqual(['one@example.com']);
  });

  test('the same link in a browser unsubscribes and says so', async () => {
    const token = unsubscribeToken('two@example.com');
    const r = await request(app).get(`/api/unsubscribe/${token}`);
    expect(r.status).toBe(200);
    expect(r.text.toLowerCase()).toContain('unsubscribed');
    expect((await db.select().from(emailOptOuts)).map(o => o.email)).toEqual(['two@example.com']);
  });

  test('A TAMPERED TOKEN UNSUBSCRIBES NOBODY', async () => {
    const good = unsubscribeToken('one@example.com');
    const forged = `${good.slice(0, -1)}${good.endsWith('a') ? 'b' : 'a'}`;
    const r = await request(app).get(`/api/unsubscribe/${forged}`);
    expect(r.status).toBe(400);
    expect(await db.select().from(emailOptOuts)).toHaveLength(0);
    const r2 = await request(app).get('/api/unsubscribe/not-a-token');
    expect(r2.status).toBe(400);
    expect(await db.select().from(emailOptOuts)).toHaveLength(0);
  });

  test('unsubscribing twice is not an error and leaves one row', async () => {
    const token = unsubscribeToken('one@example.com');
    await request(app).post(`/api/unsubscribe/${token}`);
    const second = await request(app).post(`/api/unsubscribe/${token}`);
    expect(second.status).toBe(200);
    expect(await db.select().from(emailOptOuts)).toHaveLength(1);
  });

  test('ONE UNSUBSCRIBE COVERS EVERY LATER BROADCAST, and is recorded as suppressed', async () => {
    await request(app).post(`/api/unsubscribe/${unsubscribeToken('two@example.com')}`);
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(sent.map(s => s.to).sort()).toEqual(['one@example.com', 'three@example.com']);
    expect(r.body.suppressed).toBe(1);
    const rows = await rowsFor(r.body.broadcastId);
    expect(rows.find(x => x.email === 'two@example.com')?.status).toBe('suppressed');
  });

  test('the address is the identity: case and surrounding space do not let one through', async () => {
    await request(app).post(`/api/unsubscribe/${unsubscribeToken('  TWO@Example.com ')}`);
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(sent.map(s => s.to)).not.toContain('two@example.com');
    expect(r.body.suppressed).toBe(1);
  });
});

describe('THE GUARDS', () => {
  test('only a platform admin may send', async () => {
    platform = false;
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(r.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  test('an audience over the cap is refused rather than run', async () => {
    const many = Array.from({ length: 520 }, (_, i) => ({
      agentId: `big-${i}`,
      email: `big${i}@example.com`,
      optedIn: true,
    }));
    await truncateAll();
    await seed(many);
    const r = await post({ ...MESSAGE, seasonId: SEASON });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/500/);
    expect(sent).toHaveLength(0);
  });

  test('a message with no subject or no body is refused', async () => {
    expect((await post({ ...MESSAGE, subject: '   ', seasonId: SEASON })).status).toBe(400);
    expect((await post({ ...MESSAGE, body: '', seasonId: SEASON })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('an unknown audience is refused', async () => {
    const r = await post({ ...MESSAGE, audience: 'everyone', seasonId: SEASON });
    expect(r.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('what was sent can be read back afterwards', async () => {
    const first = await post({ ...MESSAGE, seasonId: SEASON });
    const list = await request(app).get('/api/admin/broadcasts');
    expect(list.status).toBe(200);
    expect(list.body.broadcasts[0].id).toBe(first.body.broadcastId);
    expect(list.body.broadcasts[0].subject).toBe('A new game on Telarchy');
    expect(list.body.broadcasts[0].sent).toBe(3);
  });
});
